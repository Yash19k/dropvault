# Share emails are sent from sender_email. When sender_ses_arn is not given,
# Terraform registers sender_email as an SES identity: AWS then emails that
# address a verification link, which must be clicked before sharing works.
#
# Note: a new AWS account's SES is in the "sandbox" - it can only send TO
# verified addresses too, until you request production access in the SES console.
resource "aws_ses_email_identity" "sender" {
  count = var.sender_ses_arn == "" ? 1 : 0
  email = var.sender_email
}

locals {
  sender_ses_arn = var.sender_ses_arn != "" ? var.sender_ses_arn : aws_ses_email_identity.sender[0].arn
}
