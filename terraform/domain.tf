# Optional custom domain. Enclave issues its OWN regional ACM certificate
# (DNS-validated in the provided hosted zone) - it never reuses another service's
# certificate. Enabled only when api_domain_name is set.
locals {
  domain_enabled = var.api_domain_name != ""
}

resource "aws_acm_certificate" "api" {
  count             = local.domain_enabled ? 1 : 0
  domain_name       = var.api_domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.domain_enabled ? {
    for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}
  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  count                   = local.domain_enabled ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# API Gateway custom domain (regional) mapped at the root -> https://domain/v1/...
resource "aws_api_gateway_domain_name" "api" {
  count                    = local.domain_enabled ? 1 : 0
  domain_name              = var.api_domain_name
  regional_certificate_arn = aws_acm_certificate_validation.api[0].certificate_arn
  endpoint_configuration { types = ["REGIONAL"] }
}

resource "aws_api_gateway_base_path_mapping" "api" {
  count       = local.domain_enabled ? 1 : 0
  api_id      = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  domain_name = aws_api_gateway_domain_name.api[0].domain_name
}

resource "aws_route53_record" "api" {
  count   = local.domain_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.api_domain_name
  type    = "A"
  alias {
    name                   = aws_api_gateway_domain_name.api[0].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api[0].regional_zone_id
    evaluate_target_health = false
  }
}
