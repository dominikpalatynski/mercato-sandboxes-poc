terraform {
  backend "s3" {
    bucket = "om-sandboxes-tfbucket"
    key    = "terraform-om-sandbox/terraform.tfstate"
    endpoints = {
      s3 = "fsn1.your-objectstorage.com"
    }
    skip_requesting_account_id  = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    use_path_style              = true
  }
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.51.0"
    }
  }
}

provider "hcloud" {}