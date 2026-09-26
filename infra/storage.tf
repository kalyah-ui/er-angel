# ---- Object Storage (S3-compatible): ElevenLabs voice cache + nightly SQLite backups.
# Toronto has no Object Storage; New Jersey (ewr1) is the nearest cluster.
# The bucket itself is created by the backend: `node scripts/storage-init.js`.

variable "object_storage_cluster_id" {
  description = "Vultr Object Storage cluster: 2 = ewr1.vultrobjects.com (New Jersey)"
  type        = number
  default     = 2
}

variable "object_storage_tier_id" {
  description = "Vultr Object Storage tier: 2 = Standard ($18/mo), 6 = Archival ($6/mo, for infrequently accessed data)"
  type        = number
  default     = 2
}

resource "vultr_object_storage" "main" {
  label      = "${var.name}-storage"
  cluster_id = var.object_storage_cluster_id
  tier_id    = var.object_storage_tier_id

  # Deleting the subscription deletes every backup in it.
  lifecycle {
    prevent_destroy = true
  }
}

output "s3_endpoint" {
  description = "S3_ENDPOINT for the server's .env"
  value       = "https://${vultr_object_storage.main.s3_hostname}"
}

output "s3_bucket" {
  description = "S3_BUCKET for the server's .env (bucket names are unique per cluster)"
  value       = "${var.name}-${substr(vultr_object_storage.main.id, 0, 8)}"
}

# Sensitive: never printed by plan/apply. Copied straight into the server's
# .env by infra/push-storage-keys.ps1 -- they are also in terraform.tfstate.
output "s3_access_key" {
  value     = vultr_object_storage.main.s3_access_key
  sensitive = true
}

output "s3_secret_key" {
  value     = vultr_object_storage.main.s3_secret_key
  sensitive = true
}
