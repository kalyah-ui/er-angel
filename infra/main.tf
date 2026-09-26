data "vultr_os" "ubuntu" {
  filter {
    name   = "name"
    values = [var.os_name]
  }
}

resource "vultr_ssh_key" "main" {
  name    = "${var.name}-deploy"
  ssh_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
}

# ---- Firewall: SSH (key-only, enforced by cloud-init) + HTTP/HTTPS for Caddy.
resource "vultr_firewall_group" "main" {
  description = "${var.name}: ssh, http, https"
}

resource "vultr_firewall_rule" "ipv4" {
  for_each = {
    ssh   = "22"
    http  = "80"
    https = "443"
  }

  firewall_group_id = vultr_firewall_group.main.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = each.value
  notes             = each.key
}

# ---- Reserved IP: survives instance rebuilds, so the sslip.io hostname,
# HTTPS certificate, and kiosk VITE_API_URL stay the same.
resource "vultr_reserved_ip" "main" {
  label   = "${var.name}-ip"
  region  = var.region
  ip_type = "v4"

  lifecycle {
    prevent_destroy = true
  }
}

resource "vultr_instance" "main" {
  label             = var.name
  hostname          = var.name
  region            = var.region
  plan              = var.plan
  os_id             = data.vultr_os.ubuntu.id
  ssh_key_ids       = [vultr_ssh_key.main.id]
  firewall_group_id = vultr_firewall_group.main.id
  reserved_ip_id    = vultr_reserved_ip.main.id
  enable_ipv6       = false
  backups           = "disabled"
  ddos_protection   = false
  activation_email  = false

  # No secrets here: user data is stored in Vultr's instance metadata.
  user_data = file("${path.module}/cloud-init.yaml")

  lifecycle {
    prevent_destroy = true
    # cloud-init only runs on first boot; editing it later shouldn't try to
    # replace the server.
    ignore_changes = [user_data]
  }
}
