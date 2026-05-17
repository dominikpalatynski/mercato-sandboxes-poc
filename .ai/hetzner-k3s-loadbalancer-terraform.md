# Hetzner Load Balancer dla k3s — Terraform / OpenTofu

## Cel

Chcemy dodać jeden Hetzner Load Balancer przed klastrem k3s.

Docelowy flow ruchu:

```txt
Browser
  ↓
DNS wildcard: *.sandbox.twojadomena.pl
  ↓
Hetzner Load Balancer public IPv4
  ↓
private network
  ↓
worker node: 80/443
  ↓
Traefik w k3s
  ↓
Kubernetes Ingress
  ↓
Service
  ↓
Pod sandboxa
```

Ten model jest dobry dla sandboxów, bo nie tworzymy osobnego Load Balancera dla każdego sandboxa.

Zamiast tego robimy:

```txt
1 Load Balancer
1 wildcard DNS
N Ingressów w Kubernetes
N sandboxów
```

---

## Założenia

Zakładam, że masz już w Terraformie/OpenTofu:

```hcl
hcloud_network.k3s
hcloud_network_subnet.k3s
hcloud_server.master
hcloud_server.worker_sandbox
```

Przykładowe adresy:

```txt
Private network: 10.0.0.0/16
Subnet:          10.0.1.0/24

master-01:           10.0.1.10
worker-sandbox-01:   10.0.1.20
load-balancer:       10.0.1.5
```

Load Balancer będzie miał:

```txt
public IPv4: przydzielony przez Hetzner
private IP:  10.0.1.5
```

---

## 1. Zmienne

Dodaj do `variables.tf`:

```hcl
variable "location" {
  type        = string
  description = "Hetzner Cloud location"
  default     = "fsn1"
}

variable "network_ip_range" {
  type        = string
  description = "Private network IP range"
  default     = "10.0.0.0/16"
}

variable "load_balancer_private_ip" {
  type        = string
  description = "Private IP for Hetzner Load Balancer"
  default     = "10.0.1.5"
}

variable "load_balancer_type" {
  type        = string
  description = "Hetzner Load Balancer type"
  default     = "lb11"
}
```

---

## 2. Load Balancer resource

Dodaj do `main.tf` albo osobnego pliku, np. `load-balancer.tf`:

```hcl
resource "hcloud_load_balancer" "k3s" {
  name               = "k3s-lb"
  load_balancer_type = var.load_balancer_type
  location           = var.location
}
```

To tworzy Hetzner Load Balancer typu `lb11`.

---

## 3. Podpięcie Load Balancera do private network

```hcl
resource "hcloud_load_balancer_network" "k3s" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  network_id       = hcloud_network.k3s.id
  ip               = var.load_balancer_private_ip

  depends_on = [
    hcloud_network_subnet.k3s
  ]
}
```

Dzięki temu Load Balancer może komunikować się z node’ami po private IP, np.:

```txt
LB:      10.0.1.5
worker:  10.0.1.20
```

---

## 4. Targety Load Balancera

### Rekomendowany MVP: targetuj worker node

Jeżeli na `worker-sandbox-01` działa Traefik / porty 80 i 443 są dostępne, możesz targetować tylko workera:

```hcl
resource "hcloud_load_balancer_target" "worker_sandbox" {
  type             = "server"
  load_balancer_id = hcloud_load_balancer.k3s.id
  server_id        = hcloud_server.worker_sandbox.id
  use_private_ip   = true

  depends_on = [
    hcloud_load_balancer_network.k3s
  ]
}
```

`use_private_ip = true` oznacza, że Load Balancer będzie wysyłał ruch do node’a po private network, a nie po publicznym IP.

### Opcjonalnie: targetowanie mastera

Na MVP możesz też targetować mastera, ale docelowo lepiej nie puszczać ruchu aplikacyjnego przez control-plane.

Jeżeli mimo wszystko chcesz dodać mastera jako target:

```hcl
resource "hcloud_load_balancer_target" "master" {
  type             = "server"
  load_balancer_id = hcloud_load_balancer.k3s.id
  server_id        = hcloud_server.master.id
  use_private_ip   = true

  depends_on = [
    hcloud_load_balancer_network.k3s
  ]
}
```

Lepszy docelowy układ:

```txt
master-01             control-plane only
worker-ingress-01     target Load Balancera
worker-sandbox-01     sandbox workloads
worker-sandbox-02     sandbox workloads
```

---

## 5. Usługi Load Balancera: HTTP i HTTPS

Dodaj listener dla HTTP:

```hcl
resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"

  listen_port      = 80
  destination_port = 80
}
```

Dodaj listener dla HTTPS:

```hcl
resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"

  listen_port      = 443
  destination_port = 443
}
```

Używamy `protocol = "tcp"`, bo chcemy, żeby TLS kończył się w Kubernetesie na Traefiku/cert-managerze, a nie na Hetzner Load Balancerze.

Czyli:

```txt
LB:443
  ↓ TCP passthrough
Traefik:443
  ↓ TLS termination
Ingress
  ↓
Service
```

---

## 6. Outputy

Dodaj do `outputs.tf`:

```hcl
output "load_balancer_ipv4" {
  description = "Public IPv4 address of Hetzner Load Balancer"
  value       = hcloud_load_balancer.k3s.ipv4
}

output "load_balancer_ipv6" {
  description = "Public IPv6 address of Hetzner Load Balancer"
  value       = hcloud_load_balancer.k3s.ipv6
}

output "load_balancer_private_ip" {
  description = "Private IP address of Hetzner Load Balancer"
  value       = var.load_balancer_private_ip
}
```

Po `apply` sprawdzisz IP:

```bash
terraform output load_balancer_ipv4
```

albo przy OpenTofu:

```bash
tofu output load_balancer_ipv4
```

---

## 7. Pełny przykład `load-balancer.tf`

```hcl
resource "hcloud_load_balancer" "k3s" {
  name               = "k3s-lb"
  load_balancer_type = var.load_balancer_type
  location           = var.location
}

resource "hcloud_load_balancer_network" "k3s" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  network_id       = hcloud_network.k3s.id
  ip               = var.load_balancer_private_ip

  depends_on = [
    hcloud_network_subnet.k3s
  ]
}

resource "hcloud_load_balancer_target" "worker_sandbox" {
  type             = "server"
  load_balancer_id = hcloud_load_balancer.k3s.id
  server_id        = hcloud_server.worker_sandbox.id
  use_private_ip   = true

  depends_on = [
    hcloud_load_balancer_network.k3s
  ]
}

resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"

  listen_port      = 80
  destination_port = 80
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"

  listen_port      = 443
  destination_port = 443
}
```

---

## 8. Firewall dla node’ów

Jeżeli chcesz, żeby ruch HTTP/HTTPS szedł tylko przez Load Balancer, nie otwieraj portów 80/443 na cały internet na node’ach.

Zamiast:

```hcl
source_ips = ["0.0.0.0/0", "::/0"]
```

dla portów 80/443 ustaw:

```hcl
rule {
  direction  = "in"
  protocol   = "tcp"
  port       = "80"
  source_ips = [var.network_ip_range]
}

rule {
  direction  = "in"
  protocol   = "tcp"
  port       = "443"
  source_ips = [var.network_ip_range]
}
```

Wtedy ruch wygląda tak:

```txt
Internet
  ↓
Load Balancer public IP
  ↓
Load Balancer private IP
  ↓
worker private IP:80/443
```

A nie tak:

```txt
Internet
  ↓
worker public IP:80/443
```

### Minimalny firewall dla node’ów

Przykład:

```hcl
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
  # admin IP + private network
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = [
      var.allowed_admin_cidr,
      var.network_ip_range
    ]
  }

  # HTTP only from private network / Load Balancer
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = [var.network_ip_range]
  }

  # HTTPS only from private network / Load Balancer
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = [var.network_ip_range]
  }

  # Flannel VXLAN
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = [var.network_ip_range]
  }

  # Kubelet
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = [var.network_ip_range]
  }

  # ICMP for debugging
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = [var.network_ip_range]
  }
}
```

---

## 9. DNS wildcard

Po utworzeniu Load Balancera pobierz jego publiczny IPv4:

```bash
tofu output load_balancer_ipv4
```

W DNS dodaj rekord:

```txt
Type: A
Name: *.sandbox
Value: LOAD_BALANCER_IPV4
TTL: 300
```

Przykład:

```txt
A    *.sandbox    49.13.123.10
```

Dla domeny `twojadomena.pl` będzie to obsługiwać:

```txt
pr-123.sandbox.twojadomena.pl
preview-456.sandbox.twojadomena.pl
user-abc.sandbox.twojadomena.pl
```

Jeżeli panel DNS wymaga pełnej nazwy, wpisz:

```txt
*.sandbox.twojadomena.pl
```

---

## 10. Ingress dla sandboxa

Przykładowy Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sandbox-pr-123
  namespace: default
spec:
  rules:
    - host: pr-123.sandbox.twojadomena.pl
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sandbox-pr-123
                port:
                  number: 80
```

Ruch przejdzie tak:

```txt
pr-123.sandbox.twojadomena.pl
  ↓ DNS wildcard
Hetzner Load Balancer
  ↓
Traefik
  ↓
Ingress host rule
  ↓
Service sandbox-pr-123
  ↓
Pod
```

---

## 11. Test po wdrożeniu

Po `tofu apply`:

```bash
tofu output load_balancer_ipv4
```

Sprawdź DNS:

```bash
dig +short pr-123.sandbox.twojadomena.pl
```

Powinno zwrócić IP Load Balancera.

Sprawdź, czy port 80 odpowiada:

```bash
curl -I http://pr-123.sandbox.twojadomena.pl
```

Jeżeli masz TLS/cert-manager:

```bash
curl -I https://pr-123.sandbox.twojadomena.pl
```

---

## 12. Ważna uwaga o Traefiku w k3s

Domyślny k3s instaluje Traefik oraz ServiceLB. W prostym setupie może to działać od razu, ale musisz potwierdzić, że porty 80/443 są dostępne na node, który jest targetem Load Balancera.

Sprawdź:

```bash
kubectl get svc -A | grep -i traefik
kubectl get pods -A -o wide | grep -i traefik
```

Jeżeli Load Balancer targetuje `worker-sandbox-01`, a Traefik/ServiceLB działa tylko na innym node, ruch może nie dojść.

Na MVP możesz:

```txt
- targetować node, na którym faktycznie działa Traefik/ServiceLB
- albo mieć osobny worker-ingress-01
- albo skonfigurować Traefik jako DaemonSet na ingress node’ach
```

Docelowo najlepszy układ:

```txt
master-01
  control-plane only

worker-ingress-01
  przyjmuje ruch z Load Balancera
  działa Traefik

worker-sandbox-01
  sandbox workloads

worker-sandbox-02
  sandbox workloads
```

---

## 13. Czy używać HTTP/HTTPS mode na Hetzner LB?

Na start użyj:

```hcl
protocol = "tcp"
```

Dlaczego?

Bo wtedy TLS ogarniasz w Kubernetesie:

```txt
cert-manager
Traefik
Ingress TLS
Kubernetes Secret z certyfikatem
```

Nie musisz zarządzać certyfikatami na Hetzner Load Balancerze.

To jest lepsze, jeśli masz dużo dynamicznych subdomen sandboxowych.

---

## 14. Najważniejszy fragment do zapamiętania

Minimalny kod:

```hcl
resource "hcloud_load_balancer" "k3s" {
  name               = "k3s-lb"
  load_balancer_type = "lb11"
  location           = var.location
}

resource "hcloud_load_balancer_network" "k3s" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  network_id       = hcloud_network.k3s.id
  ip               = var.load_balancer_private_ip
}

resource "hcloud_load_balancer_target" "worker_sandbox" {
  type             = "server"
  load_balancer_id = hcloud_load_balancer.k3s.id
  server_id        = hcloud_server.worker_sandbox.id
  use_private_ip   = true

  depends_on = [
    hcloud_load_balancer_network.k3s
  ]
}

resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"
  listen_port      = 80
  destination_port = 80
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.k3s.id
  protocol         = "tcp"
  listen_port      = 443
  destination_port = 443
}
```

DNS:

```txt
A    *.sandbox    LOAD_BALANCER_IPV4
```

I potem każdy sandbox dostaje swój Ingress:

```txt
pr-123.sandbox.twojadomena.pl
```
