# Data Storage and Security Policy

**Effective Date:** July 23, 2026  
**Company:** Whizunik

This document outlines the infrastructure and security measures Whizunik employs to ensure that all financial and personal data processed by our ledger platform is highly secure and isolated.

---

## 1. Cloud Infrastructure

We employ industry-standard cloud infrastructure to ensure your data is highly secure, redundant, and available.

- **Amazon Web Services (AWS):** The entirety of your data is hosted on AWS, leveraging their world-class data centers and compliance frameworks.
- **Database (DynamoDB):** Structured data (such as user accounts, ledger entries, accounting records, and application state) is stored in Amazon DynamoDB. This provides us with scalable, fast, and encrypted-at-rest database capabilities.
- **File Storage (S3):** Uploaded documents (such as PDF invoices, receipts) and generated reports are stored securely in Amazon S3 buckets. Access to these buckets is strictly governed by IAM policies, ensuring only authorized application layers can read or write data.

---

## 2. Security Measures

Protecting your financial data is our top priority. We implement multiple layers of security to prevent unauthorized access and data breaches.

- **Encryption:** 
  - **In-Transit:** All data transmitted between your browser and our servers, or between our internal microservices, is encrypted using TLS/SSL.
  - **At-Rest:** Data stored in DynamoDB and S3 is encrypted at rest via AWS managed encryption keys (KMS).
  - **Passwords:** User passwords are never stored in plain text; they are securely hashed and salted using `bcrypt`.
- **Authentication & Authorization:** 
  - Sessions are secured using JSON Web Tokens (JWT).
  - We employ strict role-based access control (RBAC) to ensure that users (e.g., Admins vs. Checkers) can only access the data and actions permitted by their role.
- **Multi-Tenant Isolation:** 
  - Whizunik is a multi-tenant platform. Data for different organizations is logically separated within our database and storage layers. Strict tenant-ID verification is enforced on every API request to ensure absolute tenant privacy and prevent cross-tenant data leakage.

> [!CAUTION]
> While we take extensive measures to secure our infrastructure and your data, no system is entirely impenetrable. You are responsible for keeping your login credentials confidential and utilizing strong passwords.
