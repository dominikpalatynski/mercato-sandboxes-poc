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

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [var.allowed_admin_cidr]
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "6443"
    source_ips = [
      var.allowed_admin_cidr,
      var.network_ip_range,
    ]
  }

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

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = [var.network_ip_range]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = [var.network_ip_range]
  }

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

  ssh_keys = [hcloud_ssh_key.main.id]

  firewall_ids = [hcloud_firewall.k3s.id]

  network {
    network_id = hcloud_network.k3s.id
    ip         = var.master_private_ip
  }

  depends_on = [hcloud_network_subnet.k3s]
}

resource "hcloud_server" "sandbox_workers" {
  for_each = var.sandbox_workers

  name        = each.key
  image       = "ubuntu-24.04"
  server_type = each.value.server_type
  location    = var.location

  ssh_keys = [hcloud_ssh_key.main.id]

  firewall_ids = [hcloud_firewall.k3s.id]

  network {
    network_id = hcloud_network.k3s.id
    ip         = each.value.private_ip
  }

  depends_on = [hcloud_network_subnet.k3s]
}
