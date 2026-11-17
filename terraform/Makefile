TF_VARS ?= terraform.tfvars

.PHONY: init plan apply destroy output fmt validate clean

## init : terraform init (downloads providers)
init:
	terraform init -input=false

## plan : preview changes (Terraform builds the lambda packages itself)
plan: init
	terraform plan -var-file=$(TF_VARS)

## apply : one-command deploy (packages lambdas + layers, then provisions)
apply: init
	terraform apply -input=false -auto-approve -var-file=$(TF_VARS)

## destroy : tear everything down
destroy:
	terraform destroy -auto-approve -var-file=$(TF_VARS)

## output : show stack outputs (API URL, bucket, table, key id)
output:
	terraform output


## clean-kms : delete ALL runtime per-user KMS keys/aliases now (destructive - also
##             runs automatically on destroy; will break access to existing files)
clean-kms:
	@PREFIX="$$(awk -F'"' '/^app_name/{a=$$2} /^environment/{e=$$2} END{print a"-"e}' $(TF_VARS))"; \
	REGION="$$(awk -F'"' '/^aws_region/{print $$2}' $(TF_VARS))"; \
	PROFILE="$$(awk -F'"' '/^aws_profile/{print $$2}' $(TF_VARS))"; \
	PREFIX="$$PREFIX" REGION="$$REGION" PROFILE="$$PROFILE" bash cleanup_kms.sh

## validate : terraform validate
validate: init
	terraform validate

## fmt : format the terraform
fmt:
	terraform fmt -recursive

clean:
	rm -rf build .terraform terraform.tfstate.backup
