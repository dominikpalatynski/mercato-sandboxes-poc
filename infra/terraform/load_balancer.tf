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
    hcloud_network_subnet.k3s,
  ]
}

resource "hcloud_load_balancer_target" "sandbox_workers" {
  for_each = hcloud_server.sandbox_workers

  type             = "server"
  load_balancer_id = hcloud_load_balancer.k3s.id
  server_id        = each.value.id
  use_private_ip   = true

  depends_on = [
    hcloud_load_balancer_network.k3s,
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
