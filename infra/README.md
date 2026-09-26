# ER Angel infrastructure (Terraform, Vultr)

Creates: SSH key (from `~/.ssh/id_ed25519.pub`), firewall (tcp 22/80/443),
reserved IPv4, and an Ubuntu 24.04 instance in Toronto (`vc2-2c-4gb`) that
installs Docker + compose on first boot (`cloud-init.yaml`, no secrets).

```powershell
cd infra
terraform init
terraform plan -out er-angel.tfplan   # review
terraform apply er-angel.tfplan
terraform output                      # ip_address, sslip_hostname, ssh_command
```

The Vultr API key comes from the `VULTR_API_KEY` environment variable.

The instance and reserved IP have `prevent_destroy`, so `terraform destroy`
refuses to delete them. To tear down on purpose, remove those `lifecycle`
lines first.

## terraform.tfstate contains secrets

The state file records every resource attribute. Once Object Storage is added
it holds the S3 access/secret keys, in plain text. It is gitignored. Never
commit it, paste it, or put it in a shared drive.

Back it up after every `apply`: copy `terraform.tfstate` somewhere private
and encrypted, e.g. a password-manager attachment or an encrypted archive.
Without it Terraform no longer knows these resources exist.
