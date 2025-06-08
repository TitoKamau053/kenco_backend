INSERT INTO payments (tenant_id, property_id, amount, payment_date, payment_method, payment_status, reference_number) VALUES
(1, 2, 120000.00, '2023-12-01', 'bank_transfer', 'completed', 'PAY-2023120101'),
(1, 2, 120000.00, '2024-01-01', 'bank_transfer', 'completed', 'PAY-2024010101'),
(2, 4, 25000.00, '2023-11-01', 'mpesa', 'completed', 'PAY-2023110102'),
(2, 4, 25000.00, '2023-12-01', 'mpesa', 'completed', 'PAY-2023120102'),
(2, 4, 25000.00, '2024-01-01', 'mpesa', 'pending', 'PAY-2024010102'),
(1, 2, 120000, '2024-03-01', 'mpesa', 'completed', 'MPESA-123456789'),
(1, 2, 120000, '2024-02-01', 'mpesa', 'completed', 'MPESA-987654321'),
(2, 5, 200000, '2024-03-01', 'mpesa', 'completed', 'MPESA-456789123');
