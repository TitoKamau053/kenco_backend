INSERT INTO maintenance_requests (property_id, tenant_id, issue_type, description, priority, status) VALUES
(2, 1, 'Plumbing', 'Kitchen sink is leaking', 'medium', 'completed'),
(2, 1, 'Electrical', 'Power outlet not working in master bedroom', 'high', 'in_progress'),
(4, 2, 'General', 'Window handle is broken', 'low', 'pending');

INSERT INTO documents (property_id, tenant_id, document_type, document_url) VALUES
(2, 1, 'lease_agreement', 'https://example.com/documents/lease_1.pdf'),
(2, 1, 'payment_receipt', 'https://example.com/documents/receipt_1.pdf'),
(4, 2, 'lease_agreement', 'https://example.com/documents/lease_2.pdf'),
(4, 2, 'maintenance_report', 'https://example.com/documents/maintenance_1.pdf');
