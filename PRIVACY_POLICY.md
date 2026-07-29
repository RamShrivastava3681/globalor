# Privacy Policy

**Effective Date:** July 23, 2026  
**Company:** Whizunik

Welcome to the Privacy Policy for the Whizunik Ledger and Accounting Platform. We are committed to protecting the privacy and security of your data. This document outlines how we collect, use, process, and safeguard your personal and financial information.

> [!IMPORTANT]
> By using Whizunik's services, you consent to the data practices described in this policy. If you do not agree with these practices, please discontinue use of the application immediately.

---

## 1. Information We Collect

We collect information to provide, maintain, and improve our services. Since Whizunik operates as a comprehensive B2B accounting and ledger system, the data we collect is often sensitive and financial in nature.

### A. Personal and Account Information
- **Account Details:** Name, email address, password (stored securely using bcrypt hashing), and role-based access information (Admin, Checker, User, etc.).
- **Organization Information:** Business details, multi-tenant workspace configurations, and settings.

### B. Financial and Transactional Data
We collect and process data you input or upload into the system, which includes:
- **Ledger & Accounting:** Invoices, credit/debit notes, proformas, advances, and bulk payments.
- **Entity Data:** Debtors, vendors, and suppliers information.
- **Inventory & Operations:** Inventory tracking, expenses, and queue management details.

### C. Automatically Collected Data & Uploaded Documents
- **Document Uploads:** Invoices, receipts, and other files uploaded to the platform.
- **OCR Processing:** Data extracted from PDFs and images using built-in OCR technologies (Tesseract and PDF-Parse).
- **Log Data:** System alerts, audit trails, login events (JWT tokens), and error logs.

---

## 2. How We Use Your Data

We process your data strictly to facilitate the services you have subscribed to:

| Purpose | Description |
| :--- | :--- |
| **Service Provision** | To provide accounting, inventory, reporting, and payment features. |
| **Document Processing** | To automatically extract data from uploaded invoices using our OCR pipeline. |
| **Authentication & Security** | To authenticate users, prevent unauthorized access, and protect against fraud. |
| **Communication** | To send transactional emails (e.g., alerts, password resets, notifications) via Nodemailer. |

> [!TIP]
> We do not sell your personal or financial data to third parties under any circumstances.

---

## 3. Data Storage and Security

We employ industry-standard cloud infrastructure (AWS) to ensure your data is highly secure. Our infrastructure utilizes DynamoDB for structured data and S3 for file storage, alongside comprehensive encryption (in-transit and at-rest), JWT authentication, and strict multi-tenant isolation.

> [!TIP]
> For a detailed breakdown of our security practices and infrastructure, please read our dedicated [Data Storage and Security Policy](file:///c:/Users/ramsh/Desktop/globalor/DATA_STORAGE_AND_SECURITY.md).

---

## 4. Data Sharing and Third-Party Services

We only share your data with trusted third-party service providers that facilitate our application’s functionality:
- **Cloud Providers:** AWS for hosting, database, and storage.
- **Communication:** Email service providers to send system notifications.

All third-party vendors are bound by strict confidentiality and data protection agreements.

---

## 5. Your Rights and Choices

Depending on your jurisdiction, you may have the following rights:
- **Access & Portability:** Request a copy of the data we hold about you (e.g., via PDF or Excel exports).
- **Correction:** Edit and update inaccurate financial or personal information through the app.
- **Deletion:** Request the deletion of your account and associated data. (Note: Retention laws for financial records may apply).

---

## 6. Contact Us

If you have any questions or concerns about this Privacy Policy or our data handling practices, please contact the Whizunik support team or your organization's system administrator.
