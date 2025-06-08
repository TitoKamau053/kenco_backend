CREATE TABLE IF NOT EXISTS properties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  address VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  bedrooms INT NOT NULL,
  bathrooms DECIMAL(3, 1) NOT NULL,
  area DECIMAL(10, 2) NOT NULL,
  status ENUM('available', 'occupied', 'maintenance') DEFAULT 'available',
  landlord_id INT NOT NULL,
  images JSON DEFAULT NULL,
  amenities JSON DEFAULT NULL,
  featured BOOLEAN DEFAULT FALSE,
  property_type ENUM('apartment', 'house', 'commercial') NOT NULL DEFAULT 'apartment',
  year_built YEAR,
  available_from DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (landlord_id) REFERENCES users(id)
);

CREATE INDEX idx_property_status ON properties(status);
