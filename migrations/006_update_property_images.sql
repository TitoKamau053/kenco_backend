-- Check if foreign key exists and drop it
SELECT COUNT(*)
INTO @constraint_exists
FROM information_schema.TABLE_CONSTRAINTS 
WHERE CONSTRAINT_SCHEMA = DATABASE()
AND CONSTRAINT_NAME = 'property_images_ibfk_1'
AND TABLE_NAME = 'property_images';

SET @sql = IF(@constraint_exists > 0,
    'ALTER TABLE property_images DROP FOREIGN KEY property_images_ibfk_1',
    'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Modify image_url column
ALTER TABLE property_images 
  MODIFY image_url VARCHAR(500) NOT NULL;

-- Check and add description column if it doesn't exist
SELECT COUNT(*) 
INTO @col_exists 
FROM information_schema.COLUMNS 
WHERE TABLE_NAME = 'property_images' 
AND COLUMN_NAME = 'description'
AND TABLE_SCHEMA = DATABASE();

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE property_images ADD COLUMN description VARCHAR(255)',
    'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and add image_type column if it doesn't exist
SELECT COUNT(*) 
INTO @col_exists 
FROM information_schema.COLUMNS 
WHERE TABLE_NAME = 'property_images' 
AND COLUMN_NAME = 'image_type'
AND TABLE_SCHEMA = DATABASE();

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE property_images ADD COLUMN image_type ENUM(\'exterior\', \'interior\', \'other\') DEFAULT \'other\'',
    'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key
ALTER TABLE property_images
  ADD FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

-- Insert default images for existing properties
INSERT INTO property_images (property_id, image_url, is_primary) 
SELECT 
  id,
  'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg',
  true
FROM properties
WHERE id NOT IN (SELECT DISTINCT property_id FROM property_images);
