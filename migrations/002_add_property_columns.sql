-- Check and add images column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'images';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN images JSON DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add amenities column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'amenities';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN amenities JSON DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add featured column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'featured';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN featured BOOLEAN DEFAULT FALSE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add property_type column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'property_type';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN property_type ENUM("apartment", "house", "commercial") NOT NULL DEFAULT "apartment"', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add year_built column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'year_built';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN year_built YEAR', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check and add available_from column
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'properties' AND COLUMN_NAME = 'available_from';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE properties ADD COLUMN available_from DATE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
