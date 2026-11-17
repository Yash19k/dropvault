# Single execution role shared by the functions, scoped to exactly this app's
# bucket, table, Cognito pool and SES identity (resource-level least privilege).
resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

locals {
  base_statements = [
    {
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.files.arn}/*"
    },
    {
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:DeleteItem",
        "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan"
      ]
      Resource = aws_dynamodb_table.files.arn
    },
    {
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
      Condition = {
        "ForAllValues:StringEquals" = { "ses:FromAddress" = var.sender_email }
      }
    }
  ]

  # Encrypt/decrypt with the shared key; for per_user the upload Lambda also
  # creates a key + alias per user (CreateKey can't be resource-scoped).
  kms_statements = var.kms_mode == "s3" ? [] : [
    {
      Effect = "Allow"
      Action = [
        "kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*",
        "kms:DescribeKey", "kms:ListAliases",
        "kms:CreateKey", "kms:CreateAlias", "kms:TagResource"
      ]
      Resource = "*"
    }
  ]
}

resource "aws_iam_role_policy" "app" {
  name = "${local.prefix}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat(local.base_statements, local.kms_statements)
  })
}
