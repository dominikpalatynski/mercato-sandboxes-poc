output "master_public_ip" {
  description = "Public IPv4 address of the k3s control-plane node"
  value       = hcloud_server.master.ipv4_address
}

output "master_private_ip" {
  description = "Private IPv4 address of the k3s control-plane node"
  value       = var.master_private_ip
}

output "load_balancer_ipv4" {
  description = "Public IPv4 address of the Hetzner Load Balancer"
  value       = hcloud_load_balancer.k3s.ipv4
}

output "load_balancer_ipv6" {
  description = "Public IPv6 address of the Hetzner Load Balancer"
  value       = hcloud_load_balancer.k3s.ipv6
}

output "load_balancer_private_ip" {
  description = "Private IPv4 address of the Hetzner Load Balancer"
  value       = var.load_balancer_private_ip
}

output "sandbox_worker_public_ips" {
  description = "Public IPv4 addresses of sandbox worker nodes keyed by server name"
  value = {
    for name, server in hcloud_server.sandbox_workers :
    name => server.ipv4_address
  }
}

output "sandbox_worker_private_ips" {
  description = "Private IPv4 addresses of sandbox worker nodes keyed by server name"
  value = {
    for name, worker in var.sandbox_workers :
    name => worker.private_ip
  }
}

output "ssh_master" {
  description = "Convenience SSH command for the control-plane node"
  value       = "ssh root@${hcloud_server.master.ipv4_address}"
}

output "ssh_sandbox_workers" {
  description = "Convenience SSH commands for sandbox worker nodes keyed by server name"
  value = {
    for name, server in hcloud_server.sandbox_workers :
    name => "ssh root@${server.ipv4_address}"
  }
}
