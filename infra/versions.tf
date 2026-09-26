terraform {
  required_version = ">= 1.6"

  required_providers {
    vultr = {
      source  = "vultr/vultr"
      version = "~> 2.0"
    }
  }
}

# Reads the API key from the VULTR_API_KEY environment variable -- never put it in a file here.
provider "vultr" {}
