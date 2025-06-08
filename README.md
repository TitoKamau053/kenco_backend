# Kenco Rental Management System - Backend

## Overview
The backend server for Kenco Rental Management System built with Node.js, Express, and MySQL. It provides RESTful APIs for property management, tenant management, payments (including M-Pesa integration), and complaint handling.

## Prerequisites
- Node.js >= 18.0.0
- MySQL >= 8.0
- NPM or Yarn package manager

## Technology Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL
- **Authentication**: JWT
- **Payment Integration**: M-Pesa
- **File Upload**: Multer

## Getting Started

### Environment Setup
1. Clone the repository
2. Create a `.env` file in the backend directory with the following variables:
```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=kenco_db

# JWT Configuration
JWT_SECRET=your_jwt_secret

# M-Pesa Configuration
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey
MPESA_ENVIRONMENT=sandbox
```

### Installation
```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start development server
npm run dev

# Start production server
npm start
```

## API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - Register new landlord
- `GET /api/auth/me` - Get current user info

### Property Management
- `GET /api/properties` - Get all properties
- `POST /api/properties` - Add new property
- `GET /api/landlord/properties` - Get landlord's properties

### Tenant Management
- `POST /api/tenants` - Add new tenant
- `GET /api/tenants/:id` - Get tenant details
- `GET /api/landlord/tenants` - Get all tenants for landlord

### Payment Management
- `POST /api/payments/mpesa/initiate` - Initiate M-Pesa payment
- `GET /api/payments` - Get payment history
- `GET /api/landlord/payments` - Get landlord's payment records

### Complaint Management
- `POST /api/complaints` - Submit new complaint
- `GET /api/complaints` - Get complaints list
- `PUT /api/complaints/:id` - Update complaint status

## Database Schema

### Key Tables
- `users` - User accounts
- `properties` - Property listings
- `tenants` - Tenant records
- `payments` - Payment transactions
- `complaints` - Maintenance complaints
- `property_images` - Property images

## Error Handling
The API uses standard HTTP status codes and returns JSON responses with the following structure:
```json
{
  "success": boolean,
  "message": "Error/success message",
  "error": "Detailed error message (development only)",
  "data": {} // Optional data payload
}
```

## Security
- JWT-based authentication
- Request validation
- CORS protection
- Secure password hashing
- Environment variable protection

## File Upload
- Supports image uploads for properties
- Maximum file size: 5MB
- Allowed formats: images only
- Storage: local `uploads` directory

## Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
This project is licensed under the MIT License.
