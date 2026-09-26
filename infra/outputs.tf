output "ip_address" {
  description = "Reserved public IPv4 of the server"
  value       = vultr_reserved_ip.main.subnet
}

output "sslip_hostname" {
  description = "HTTPS hostname -- set SITE_ADDRESS in the server's .env to this"
  value       = "${replace(vultr_reserved_ip.main.subnet, ".", "-")}.sslip.io"
}

output "ssh_command" {
  description = "Connect to the server"
  value       = "ssh root@${vultr_reserved_ip.main.subnet}"
}

output "instance_id" {
  value = vultr_instance.main.id
}
