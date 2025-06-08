-- First, insert properties
INSERT INTO properties (title, description, address, price, bedrooms, bathrooms, area, status, landlord_id, property_type, year_built, available_from) VALUES
('Modern Apartment in Westlands', 'Luxurious 2-bedroom apartment with city views', '123 Westlands Road, Nairobi', 45000.00, 2, 2.0, 1200.00, 'available', 1, 'apartment', 2020, '2024-01-01'),
('Family House in Karen', 'Spacious 4-bedroom house with garden', '456 Karen Road, Nairobi', 120000.00, 4, 3.5, 3500.00, 'occupied', 1, 'house', 2018, '2024-02-01'),
('Commercial Space in CBD', 'Prime retail space', '789 Kenyatta Avenue, Nairobi', 200000.00, 0, 2.0, 2000.00, 'available', 4, 'commercial', 2015, '2024-01-15'),
('Studio Apartment Kilimani', 'Cozy studio perfect for singles', '321 Kilimani Road, Nairobi', 25000.00, 1, 1.0, 450.00, 'occupied', 4, 'apartment', 2019, '2024-01-01');

-- Then, add images for each property
INSERT INTO property_images (property_id, image_url, is_primary) VALUES
(1, 'https://example.com/images/apt1_main.jpg', TRUE),
(1, 'https://example.com/images/apt1_2.jpg', FALSE),
(2, 'https://example.com/images/house1_main.jpg', TRUE),
(3, 'https://example.com/images/commercial1_main.jpg', TRUE),
(4, 'https://example.com/images/studio1_main.jpg', TRUE);
