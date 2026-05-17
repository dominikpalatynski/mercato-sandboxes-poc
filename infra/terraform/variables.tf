variable "location" {
  type        = string
  description = "Hetzner Cloud location"
  default     = "fsn1"
}

variable "ssh_key_name" {
  type        = string
  description = "Name of SSH key in Hetzner"
  default     = "mercato-hetzner"
}

variable "ssh_public_key_path" {
  type        = string
  description = "Path to the local SSH public key"
  default     = "~/.ssh/mercato_hetzner.pub"
}

variable "allowed_admin_cidr" {
  type        = string
  description = "Public IP CIDR allowed to access SSH and the Kubernetes API"

  validation {
    condition     = can(cidrhost(var.allowed_admin_cidr, 0))
    error_message = "allowed_admin_cidr must be a valid IPv4 or IPv6 CIDR."
  }
}

variable "network_ip_range" {
  type        = string
  description = "Private network IP range"
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.network_ip_range, 0))
    error_message = "network_ip_range must be a valid CIDR."
  }
}

variable "subnet_ip_range" {
  type        = string
  description = "Private subnet IP range"
  default     = "10.0.1.0/24"

  validation {
    condition     = can(cidrhost(var.subnet_ip_range, 0))
    error_message = "subnet_ip_range must be a valid CIDR."
  }
}

variable "load_balancer_private_ip" {
  type        = string
  description = "Private IP for the Hetzner Load Balancer"
  default     = "10.0.1.5"
}

variable "load_balancer_type" {
  type        = string
  description = "Hetzner Load Balancer type"
  default     = "lb11"
}

variable "master_private_ip" {
  type        = string
  description = "Private IPv4 assigned to the k3s control-plane node"
  default     = "10.0.1.10"
}

variable "master_server_type" {
  type        = string
  description = "Hetzner server type for the control-plane node"
  default     = "cx22"
}

variable "sandbox_workers" {
  type = map(object({
    private_ip  = string
    server_type = string
  }))
  description = "Sandbox worker definitions keyed by Hetzner server name"
  default = {
    "worker-sandbox-01" = {
      private_ip  = "10.0.1.20"
      server_type = "cx32"
    }
  }

  validation {
    condition     = length(var.sandbox_workers) > 0
    error_message = "sandbox_workers must define at least one sandbox worker."
  }

  validation {
    condition = length(distinct([
      for worker in values(var.sandbox_workers) : worker.private_ip
    ])) == length(var.sandbox_workers)
    error_message = "Each sandbox worker must have a unique private_ip."
  }

  validation {
    condition = alltrue([
      for name in keys(var.sandbox_workers) : trimspace(name) != ""
    ])
    error_message = "Each sandbox worker name must be a non-empty string."
  }
}
