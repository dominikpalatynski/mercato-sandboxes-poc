# K3s na Hetzner VPS z OpenTofu: private network + worker pod sandboxy

## Cel

Chcemy postawić prosty klaster k3s na Hetzner Cloud:

- `master-01` — control-plane node
- `worker-sandbox-01` — worker node przeznaczony pod sandboxowe deploymenty
- private network między node’ami, żeby komunikacja Kubernetes nie szła po publicznym internecie
- OpenTofu do tworzenia infrastruktury:
  - VPS-y
  - private network
  - subnet
  - firewall
  - SSH key
- k3s instalowany osobnym skryptem/manualnie po utworzeniu maszyn
- worker oznaczony labelami i opcjonalnie taintem, żeby sandboxowe deploymenty odpalały się tylko tam

---

## 1. Docelowa architektura

```txt
Hetzner Project
│
├── Private Network: k3s-private-network
│   └── Subnet: 10.0.1.0/24
│
├── master-01
│   ├── public IPv4
│   └── private IP: 10.0.1.10
│
└── worker-sandbox-01
    ├── public IPv4
    └── private IP: 10.0.1.20
```

Ruch między node’ami powinien iść po private IP:

```txt
worker-sandbox-01 -> master-01
10.0.1.20        -> 10.0.1.10:6443
```

---

## 2. Co będzie zarządzane przez OpenTofu

OpenTofu powinno tworzyć:

```txt
- Hetzner Cloud Network
- Hetzner Cloud Network Subnet
- Firewall
- SSH key
- master VPS
- worker VPS
```

OpenTofu nie musi na początku instalować k3s. Lepiej rozdzielić odpowiedzialności:

```txt
OpenTofu:
  infrastruktura

Skrypty / Ansible / cloud-init:
  instalacja k3s
  join workerów
  konfiguracja labels/taints

kubectl / Helm / GitOps:
  aplikacje
  ingress
  cert-manager
  monitoring
  runtime API
  sandbox templates
```

Na MVP: OpenTofu + ręczne/skryptowe SSH jest wystarczające.

---

## 3. Wymagania lokalne

Zainstaluj:

```bash
tofu version
hcloud version # opcjonalnie, ale przydatne
ssh -V
```

Potrzebujesz też:

```txt
- Hetzner Cloud API Token
- lokalny SSH public key, np. ~/.ssh/id_ed25519.pub
- Twoje publiczne IP do ograniczenia SSH/API w firewallu
```

Token tworzysz w Hetzner Cloud Console:

```txt
Project -> Security -> API Tokens -> Generate API Token
```

Wybierz token z uprawnieniami `Read & Write`.

---

## 4. Struktura katalogu

Proponowana struktura:

```txt
k3s-hetzner/
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfvars.example
├── .gitignore
└── scripts/
    ├── install-master.sh
    ├── join-worker.sh
    └── configure-sandbox-node.sh
```

---

## 5. `.gitignore`

```gitignore
.terraform/
.terraform.lock.hcl
terraform.tfstate
terraform.tfstate.backup
*.tfvars
*.tfvars.json
```

Uwaga: `terraform.tfvars` zawiera token, więc nie wrzucaj go do repo.

---

## 6. `variables.tf`

```hcl
variable "hcloud_token" {
  type        = string
  description = "Hetzner Cloud API token"
  sensitive   = true
}

variable "location" {
  type        = string
  description = "Hetzner Cloud location"
  default     = "fsn1"
}

variable "ssh_key_name" {
  type        = string
  description = "Name of SSH key in Hetzner"
  default     = "main-ssh-key"
}

variable "ssh_public_key_path" {
  type        = string
  description = "Path to local SSH public key"
  default     = "~/.ssh/id_ed25519.pub"
}

variable "allowed_admin_cidr" {
  type        = string
  description = "Your public IP CIDR allowed to access SSH and Kubernetes API"
}

variable "network_ip_range" {
  type        = string
  description = "Private network IP range"
  default     = "10.0.0.0/16"
}

variable "subnet_ip_range" {
  type        = string
  description = "Private subnet IP range"
  default     = "10.0.1.0/24"
}

variable "master_private_ip" {
  type        = string
  default     = "10.0.1.10"
}

variable "worker_sandbox_private_ip" {
  type        = string
  default     = "10.0.1.20"
}

variable "master_server_type" {
  type        = string
  default     = "cx22"
}

variable "worker_sandbox_server_type" {
  type        = string
  default     = "cx32"
}
```

---

## 7. `main.tf`

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.51"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "main" {
  name       = var.ssh_key_name
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "hcloud_network" "k3s" {
  name     = "k3s-private-network"
  ip_range = var.network_ip_range
}

resource "hcloud_network_subnet" "k3s" {
  network_id   = hcloud_network.k3s.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = var.subnet_ip_range
}

resource "hcloud_firewall" "k3s" {
  name = "k3s-firewall"

  # SSH only from admin IP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [var.allowed_admin_cidr]
  }

  # Kubernetes API:
  # - admin IP for local kubectl access
  # - private network for worker -> master communication
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = [
      var.allowed_admin_cidr,
      var.network_ip_range
    ]
  }

  # HTTP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # HTTPS
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Flannel VXLAN traffic between nodes
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = [var.network_ip_range]
  }

  # Kubelet internal traffic
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = [var.network_ip_range]
  }

  # Optional: allow all ICMP from private network for debugging
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = [var.network_ip_range]
  }
}

resource "hcloud_server" "master" {
  name        = "master-01"
  image       = "ubuntu-24.04"
  server_type = var.master_server_type
  location    = var.location

  ssh_keys = [
    hcloud_ssh_key.main.id
  ]

  firewall_ids = [
    hcloud_firewall.k3s.id
  ]

  network {
    network_id = hcloud_network.k3s.id
    ip         = var.master_private_ip
  }

  depends_on = [
    hcloud_network_subnet.k3s
  ]
}

resource "hcloud_server" "worker_sandbox" {
  name        = "worker-sandbox-01"
  image       = "ubuntu-24.04"
  server_type = var.worker_sandbox_server_type
  location    = var.location

  ssh_keys = [
    hcloud_ssh_key.main.id
  ]

  firewall_ids = [
    hcloud_firewall.k3s.id
  ]

  network {
    network_id = hcloud_network.k3s.id
    ip         = var.worker_sandbox_private_ip
  }

  depends_on = [
    hcloud_network_subnet.k3s
  ]
}
```

---

## 8. `outputs.tf`

```hcl
output "master_public_ip" {
  value = hcloud_server.master.ipv4_address
}

output "master_private_ip" {
  value = var.master_private_ip
}

output "worker_sandbox_public_ip" {
  value = hcloud_server.worker_sandbox.ipv4_address
}

output "worker_sandbox_private_ip" {
  value = var.worker_sandbox_private_ip
}

output "ssh_master" {
  value = "ssh root@${hcloud_server.master.ipv4_address}"
}

output "ssh_worker_sandbox" {
  value = "ssh root@${hcloud_server.worker_sandbox.ipv4_address}"
}
```

---

## 9. `terraform.tfvars.example`

```hcl
hcloud_token = "YOUR_HETZNER_CLOUD_API_TOKEN"

# Example:
# allowed_admin_cidr = "1.2.3.4/32"
allowed_admin_cidr = "YOUR_PUBLIC_IP/32"

location = "fsn1"

ssh_key_name        = "dominik-main-key"
ssh_public_key_path = "~/.ssh/id_ed25519.pub"

master_server_type         = "cx22"
worker_sandbox_server_type = "cx32"
```

Utwórz lokalnie prawdziwy plik:

```bash
cp terraform.tfvars.example terraform.tfvars
```

I uzupełnij wartości.

---

## 10. Uruchomienie OpenTofu

```bash
tofu init
tofu plan
tofu apply
```

Po `apply` sprawdź outputy:

```bash
tofu output
```

Powinieneś dostać:

```txt
master_public_ip
master_private_ip
worker_sandbox_public_ip
worker_sandbox_private_ip
ssh_master
ssh_worker_sandbox
```

---

## 11. Instalacja k3s na masterze

Zaloguj się na mastera:

```bash
ssh root@MASTER_PUBLIC_IP
```

Zaktualizuj system:

```bash
apt update && apt upgrade -y
apt install -y curl vim jq htop
hostnamectl set-hostname master-01
```

Zainstaluj k3s server:

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --node-ip 10.0.1.10 \
  --advertise-address 10.0.1.10 \
  --tls-san MASTER_PUBLIC_IP \
  --tls-san 10.0.1.10 \
  --write-kubeconfig-mode 644" sh -
```

Sprawdź:

```bash
kubectl get nodes -o wide
kubectl get pods -A
```

Pobierz token potrzebny do dołączenia workerów:

```bash
cat /var/lib/rancher/k3s/server/node-token
```

Zapisz token.

---

## 12. Instalacja k3s agent na workerze

Zaloguj się na worker:

```bash
ssh root@WORKER_SANDBOX_PUBLIC_IP
```

Przygotuj system:

```bash
apt update && apt upgrade -y
apt install -y curl vim jq htop
hostnamectl set-hostname worker-sandbox-01
```

Dołącz worker do klastra:

```bash
curl -sfL https://get.k3s.io | \
  K3S_URL=https://10.0.1.10:6443 \
  K3S_TOKEN="TOKEN_Z_MASTERA" \
  INSTALL_K3S_EXEC="agent --node-ip 10.0.1.20" \
  sh -
```

Na masterze sprawdź:

```bash
kubectl get nodes -o wide
```

Oczekiwany wynik:

```txt
NAME                STATUS   ROLES                  INTERNAL-IP
master-01           Ready    control-plane,master   10.0.1.10
worker-sandbox-01   Ready    <none>                 10.0.1.20
```

---

## 13. Pobranie kubeconfig na lokalny komputer

Na lokalnym komputerze:

```bash
mkdir -p ~/.kube
scp root@MASTER_PUBLIC_IP:/etc/rancher/k3s/k3s.yaml ~/.kube/hetzner-k3s.yaml
```

Edytuj plik:

```bash
vim ~/.kube/hetzner-k3s.yaml
```

Zmień:

```yaml
server: https://127.0.0.1:6443
```

na:

```yaml
server: https://MASTER_PUBLIC_IP:6443
```

Użycie:

```bash
export KUBECONFIG=~/.kube/hetzner-k3s.yaml
kubectl get nodes -o wide
```

---

## 14. Oznaczenie workera pod sandboxy

Na masterze albo lokalnie z poprawnym kubeconfigiem:

```bash
kubectl label node worker-sandbox-01 node-type=sandbox
kubectl label node worker-sandbox-01 workload-type=sandbox
kubectl label node worker-sandbox-01 sandbox=true
```

Sprawdź:

```bash
kubectl get nodes -L node-type,workload-type,sandbox
```

---

## 15. Taint na masterze

Jeżeli masz już worker node, warto zablokować normalne workloady na control-plane:

```bash
kubectl taint nodes master-01 node-role.kubernetes.io/control-plane=true:NoSchedule
```

Sprawdź:

```bash
kubectl describe node master-01 | grep -i taints
```

Oczekiwane:

```txt
Taints: node-role.kubernetes.io/control-plane=true:NoSchedule
```

Uwaga: nie rób tego w single-node clusterze, bo zwykłe aplikacje nie będą miały gdzie wystartować.

---

## 16. Taint na workerze sandboxowym

Jeżeli chcesz, żeby na sandbox workerze działały tylko świadomie wskazane sandboxowe workloady:

```bash
kubectl taint nodes worker-sandbox-01 dedicated=sandbox:NoSchedule
```

To jest dobry model, bo:

```txt
label:
  przyciąga sandboxowe deploymenty na sandbox node

taint:
  blokuje przypadkowe deploymenty przed wejściem na sandbox node
```

Finalnie:

```bash
kubectl label node worker-sandbox-01 node-type=sandbox
kubectl taint nodes worker-sandbox-01 dedicated=sandbox:NoSchedule
```

---

## 17. Sandbox deployment tylko na sandbox workerze

Przykład:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-nginx
  labels:
    app: sandbox-nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sandbox-nginx
  template:
    metadata:
      labels:
        app: sandbox-nginx
    spec:
      nodeSelector:
        node-type: sandbox
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "sandbox"
          effect: "NoSchedule"
      containers:
        - name: nginx
          image: nginx:latest
          ports:
            - containerPort: 80

---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-nginx
spec:
  selector:
    app: sandbox-nginx
  ports:
    - port: 80
      targetPort: 80
```

Zapisz jako:

```bash
sandbox-nginx.yaml
```

Apply:

```bash
kubectl apply -f sandbox-nginx.yaml
```

Sprawdź, gdzie odpalił się pod:

```bash
kubectl get pods -o wide
```

Pod powinien działać na:

```txt
worker-sandbox-01
```

---

## 18. Debug schedulingu

Jeżeli pod jest `Pending`:

```bash
kubectl describe pod POD_NAME
```

Typowe błędy:

```txt
node(s) didn't match Pod's node affinity/selector
```

Znaczy: node nie ma wymaganego labela.

```txt
node(s) had untolerated taint
```

Znaczy: node ma taint, ale pod nie ma pasującej toleration.

Sprawdź labele:

```bash
kubectl get nodes --show-labels
kubectl get nodes -L node-type,workload-type,sandbox
```

Sprawdź tainty:

```bash
kubectl describe node master-01 | grep -i taints
kubectl describe node worker-sandbox-01 | grep -i taints
```

---

## 19. Usuwanie labeli i taintów

Usuń label:

```bash
kubectl label node worker-sandbox-01 node-type-
```

Usuń taint z workera:

```bash
kubectl taint nodes worker-sandbox-01 dedicated=sandbox:NoSchedule-
```

Usuń taint z mastera:

```bash
kubectl taint nodes master-01 node-role.kubernetes.io/control-plane=true:NoSchedule-
```

---

## 20. Dodawanie kolejnego sandbox workera

W OpenTofu możesz dodać kolejny `hcloud_server`, np.:

```hcl
resource "hcloud_server" "worker_sandbox_02" {
  name        = "worker-sandbox-02"
  image       = "ubuntu-24.04"
  server_type = var.worker_sandbox_server_type
  location    = var.location

  ssh_keys = [
    hcloud_ssh_key.main.id
  ]

  firewall_ids = [
    hcloud_firewall.k3s.id
  ]

  network {
    network_id = hcloud_network.k3s.id
    ip         = "10.0.1.21"
  }

  depends_on = [
    hcloud_network_subnet.k3s
  ]
}
```

Potem:

```bash
tofu plan
tofu apply
```

Na nowym workerze:

```bash
curl -sfL https://get.k3s.io | \
  K3S_URL=https://10.0.1.10:6443 \
  K3S_TOKEN="TOKEN_Z_MASTERA" \
  INSTALL_K3S_EXEC="agent --node-ip 10.0.1.21" \
  sh -
```

Na masterze:

```bash
kubectl label node worker-sandbox-02 node-type=sandbox
kubectl taint nodes worker-sandbox-02 dedicated=sandbox:NoSchedule
```

---

## 21. Finalny mental model

```txt
OpenTofu:
  Tworzy maszyny, sieć prywatną, firewall, SSH key.

k3s server:
  Uruchamia control-plane na master-01.

k3s agent:
  Dołącza worker-sandbox-01 do klastra.

Private Network:
  Spina node’y po 10.0.1.x, bez wystawiania komunikacji klastra na publiczny internet.

Label:
  Mówi schedulerowi: ten node nadaje się pod sandboxy.

Taint:
  Chroni node przed przypadkowymi workloadami.

Toleration:
  Pozwala konkretnemu podowi wejść na zataintowany node.
```

Najważniejsze ustawienia dla Twojego przypadku:

```bash
# Control-plane nie przyjmuje normalnych workloadów
kubectl taint nodes master-01 node-role.kubernetes.io/control-plane=true:NoSchedule

# Worker przeznaczony pod sandboxy
kubectl label node worker-sandbox-01 node-type=sandbox

# Tylko workloady z toleration mogą wejść na sandbox worker
kubectl taint nodes worker-sandbox-01 dedicated=sandbox:NoSchedule
```

Każdy sandboxowy deployment powinien mieć:

```yaml
nodeSelector:
  node-type: sandbox

tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "sandbox"
    effect: "NoSchedule"
```
