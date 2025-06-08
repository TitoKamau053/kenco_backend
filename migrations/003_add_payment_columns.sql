-- Check and add late_fee column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'late_fee';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payments ADD COLUMN late_fee DECIMAL(10, 2) DEFAULT 0.00', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add payment_period column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'payment_period';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payments ADD COLUMN payment_period DATE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add invoice_number column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'invoice_number';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payments ADD COLUMN invoice_number VARCHAR(50)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add notes column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'notes';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payments ADD COLUMN notes TEXT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
