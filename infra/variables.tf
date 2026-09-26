variable "region" {
  description = "Vultr region id (yto = Toronto)"
  type        = string
  default     = "yto"
}

variable "plan" {
  description = "Instance plan: shared CPU, 2 vCPU / 4 GB / 80 GB (~$20/mo)"
  type        = string
  default     = "vc2-2c-4gb"
}

variable "os_name" {
  description = "Exact Vultr OS name"
  type        = string
  default     = "Ubuntu 24.04 LTS x64"
}

variable "ssh_public_key_path" {
  description = "Public key uploaded to Vultr and installed for root"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "name" {
  description = "Label/hostname prefix for all resources"
  type        = string
  default     = "er-angel"
}
