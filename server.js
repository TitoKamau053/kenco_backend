import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { createConnection } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MpesaService } from './services/mpesa.js';

// Load environment variables
dotenv.config();

// ES Module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://kenco-ui.vercel.app',  
    /\.vercel\.app$/  // This will allow all vercel.app subdomains
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fixed MySQL Connection Configuration for Aiven
const connectDB = async () => {
  try {
    const connection = await createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,  // Convert to number
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'kenco_db',
      // SSL configuration for Aiven
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false  // For Aiven cloud database
      } : false,
      // Connection timeout settings (removed invalid options)
      connectTimeout: 60000,  // 60 seconds
      // Additional connection settings for cloud databases
      reconnect: true
    });
    
    console.log('MySQL Connected to:', process.env.DB_HOST);
    return connection;
  } catch (err) {
    console.error('MySQL connection error:', err);
    console.error('Connection details:', {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL
    });
    process.exit(1);
  }
};
// Initialize database with tables
const initializeDB = async (connection) => {
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('landlord', 'tenant', 'admin') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create properties table
    await connection.execute(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (landlord_id) REFERENCES users(id)
      )
    `);

    // Create tenants table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        property_id INT NOT NULL,
        rent_amount DECIMAL(10, 2) NOT NULL,
        lease_start DATE NOT NULL,
        lease_end DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (property_id) REFERENCES properties(id)
      )
    `);

    // Create payments table with notes column
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        property_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        payment_status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
        reference_number VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (property_id) REFERENCES properties(id)
      )
    `);

    // Create complaints table with category field
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS complaints (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        property_id INT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'other',
        status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (property_id) REFERENCES properties(id)
      )
    `);

    // Create property_images table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS property_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        property_id INT NOT NULL,
        image_url VARCHAR(255) NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (property_id) REFERENCES properties(id)
      )
    `);

    console.log('Database tables initialized...');
  } catch (err) {
    console.error('Database initialization error:', err);
    process.exit(1);
  }
};

// Make connection available globally
let connection;

// Initialize M-Pesa service with validation
const mpesaConfig = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  passkey: process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  shortcode: process.env.MPESA_SHORTCODE || '174379',
  environment: process.env.MPESA_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
};

// Log configuration (without secrets) for debugging
console.log('M-Pesa Configuration:', {
  environment: mpesaConfig.environment,
  shortcode: mpesaConfig.shortcode,
  hasConsumerKey: !!mpesaConfig.consumerKey,
  hasConsumerSecret: !!mpesaConfig.consumerSecret,
  hasPasskey: !!mpesaConfig.passkey
});

const mpesaService = new MpesaService(mpesaConfig);

// Validate configuration on startup
const configValidation = mpesaService.validateConfig();
if (!configValidation.valid) {
  console.error('❌ M-Pesa configuration issues:', configValidation.errors);
  // Don't exit in development, just warn
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
} else {
  console.log('✅ M-Pesa service initialized successfully');
}

// Test M-Pesa connectivity on startup (sandbox only)
if (mpesaConfig.environment === 'sandbox') {
  setTimeout(async () => {
    try {
      console.log('🧪 Testing M-Pesa sandbox connectivity...');
      const token = await mpesaService.getAccessToken();
      console.log('✅ M-Pesa sandbox connection successful');
    } catch (error) {
      console.error('❌ M-Pesa sandbox connection failed:', error.message);
    }
  }, 2000);
}

// Start server
(async () => {
  try {
    // Initialize database connection
    connection = await connectDB();
    
    // Initialize the database
    await initializeDB(connection);
    
    // Validate M-Pesa configuration on startup
    const configValidation = mpesaService.validateConfig();
    if (!configValidation.valid) {
      console.warn('M-Pesa configuration issues:', configValidation.errors);
    } else {
      console.log('M-Pesa service initialized successfully');
    }
    
    // Start listening only after database is initialized
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize server:', err);
    process.exit(1);
  }
})();

const checkAndUpdatePaymentStatus = async (checkoutRequestId, paymentId) => {
  try {
    console.log(`Checking payment status for: ${checkoutRequestId}`);
    
    const mpesaStatus = await mpesaService.checkPaymentStatus(checkoutRequestId);
    
    // Update payment record based on M-Pesa response
    if (mpesaStatus.ResultCode === "0") {
      // Payment successful
      const updateQuery = `
        UPDATE payments 
        SET payment_status = 'completed', 
            reference_number = ?,
            notes = ?
        WHERE id = ?`;
      
      const notes = JSON.stringify({
        mpesaReceiptNumber: mpesaStatus.MpesaReceiptNumber,
        transactionDate: mpesaStatus.TransactionDate,
        phoneNumber: mpesaStatus.PhoneNumber,
        checkoutRequestId: checkoutRequestId
      });
      
      await connection.execute(updateQuery, [
        mpesaStatus.MpesaReceiptNumber || checkoutRequestId,
        notes,
        paymentId
      ]);
      
      console.log(`Payment ${paymentId} marked as completed`);
      
    } else if (mpesaStatus.ResultCode !== "0") {
      // Payment failed
      await connection.execute(
        'UPDATE payments SET payment_status = ?, notes = ? WHERE id = ?',
        ['failed', `Error ${mpesaStatus.ResultCode}: ${mpesaStatus.ResultDesc}`, paymentId]
      );
      
      console.log(`Payment ${paymentId} marked as failed: ${mpesaStatus.ResultDesc}`);
    }
    
    return mpesaStatus;
  } catch (error) {
    console.error('Error checking payment status:', error);
    throw error;
  }
};

// Auth middleware with enhanced logging
const authenticateToken = (req, res, next) => {
  console.log('Auth middleware:', {
    path: req.path,
    method: req.method,
    hasAuthHeader: !!req.headers['authorization']
  });

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    console.log('Authentication failed: No token provided');
    return res.status(401).json({ 
      message: 'No token, authorization denied',
      detail: 'Please login to access this resource'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    console.log('Token verified:', {
      userId: decoded.id,
      role: decoded.role,
      path: req.path
    });
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification failed:', {
      error: err.message,
      token: token.substring(0, 10) + '...'
    });
    res.status(403).json({ 
      message: 'Token is not valid',
      detail: err.message
    });
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 5 // Max 5 files per upload
  }
});

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ message: 'Too many files. Maximum is 5 files.' });
    }
    return res.status(400).json({ message: 'File upload error.' });
  }
  next(err);
});

// Log incoming requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Helper functions
const checkRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).json({ message: `Access denied. ${role} only.` });
  }
  next();
};

const formatKES = (amount) => {
  return parseFloat(amount).toLocaleString('en-KE', {
    style: 'currency',
    currency: 'KES'
  });
};

/**
 * Authentication Routes
 * Public routes that don't require authentication
 */

// Login User
app.post('/api/auth/login', async (req, res) => {
  console.log('Login attempt received:', {
    email: req.body.email,
    hasPassword: !!req.body.password
  });

  try {
    const { email, password } = req.body;
    
    // Input validation with detailed messages
    if (!email || !password) {
      console.log('Missing credentials:', { email: !!email, password: !!password });
      return res.status(400).json({ 
        message: 'Please enter all fields',
        details: {
          email: !email ? 'Email is required' : null,
          password: !password ? 'Password is required' : null
        }
      });
    }
    
    // Check if user exists
    console.log('Querying database for user:', email);
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE email = ?', 
      [email]
    );
    
    console.log('Database response:', {
      userFound: rows.length > 0,
      timestamp: new Date().toISOString()
    });
    
    if (rows.length === 0) {
      return res.status(400).json({ 
        message: 'Invalid credentials',
        detail: 'User not found'
      });
    }
    
    const user = rows[0];
    
    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password verification:', {
      isMatch,
      timestamp: new Date().toISOString()
    });
    
    if (!isMatch) {
      return res.status(400).json({ 
        message: 'Invalid credentials',
        detail: 'Password incorrect'
      });
    }
    
    // Create and sign JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );
    
    console.log('Login successful:', {
      userId: user.id,
      role: user.role,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      message: 'Server error',
      detail: err.message
    });
  }
});

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const userRole = role === 'tenant' ? 'tenant' : 'landlord';

        // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please enter all fields' });
    }
    
    // Check if user exists
    const [rows] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
    
    if (rows.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert user as landlord
    await connection.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, userRole]
    );

    
    res.status(201).json({
      message: 'Landlord registered successfully',
      user: {
        id: result.insertId,
        name,
        email,
        role: 'landlord'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Protected Routes 
 * All routes below require valid authentication token
 */

// User Routes
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await connection.execute('SELECT id, name, email, role FROM users WHERE id = ?', [req.user.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Get user's current password
    const [user] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [req.user.id]
    );
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user[0].password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await connection.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.user.id]
    );
    
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Property Management Routes
 */

// Get all properties with filters
app.get('/api/properties', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT p.*, u.name as landlord_name, 
      COALESCE(pi.image_url, 'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg') as image
      FROM properties p 
      JOIN users u ON p.landlord_id = u.id
      LEFT JOIN property_images pi ON p.id = pi.property_id AND pi.is_primary = true
    `;
    
    // Add filters if provided
    const filters = [];
    const values = [];
    
    if (req.query.status) {
      filters.push('p.status = ?');
      values.push(req.query.status);
    }
    
    if (req.query.minPrice) {
      filters.push('p.price >= ?');
      values.push(req.query.minPrice);
    }
    
    if (req.query.maxPrice) {
      filters.push('p.price <= ?');
      values.push(req.query.maxPrice);
    }
    
    if (req.query.bedrooms) {
      filters.push('p.bedrooms >= ?');
      values.push(req.query.bedrooms);
    }
    
    if (req.query.bathrooms) {
      filters.push('p.bathrooms >= ?');
      values.push(req.query.bathrooms);
    }
    
    if (filters.length > 0) {
      query += ' WHERE ' + filters.join(' AND ');
    }
    
    const [rows] = await connection.execute(query, values);
    
    const formattedRows = rows.map(row => ({
      ...row,
      price: formatKES(row.price)
    }));
    
    res.json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new property with images
app.post('/api/properties', authenticateToken, upload.array('images', 5), async (req, res) => {
  try {
    if (req.user.role !== 'landlord') {
      // Delete uploaded files if authentication fails
      if (req.files) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(403).json({ message: 'Access denied. Landlords only.' });
    }
    
    const { title, description, address, price, bedrooms, bathrooms, area, property_type } = req.body;
    
    // Validate input
    if (!title || !address || !price || !bedrooms || !bathrooms || !area) {
      // Delete uploaded files if validation fails
      if (req.files) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ 
        message: 'Please provide all required fields',
        required: { title, address, price, bedrooms, bathrooms, area },
        received: req.body
      });
    }
    
    // Start transaction
    await connection.beginTransaction();
    
    try {
      // Insert property
      const [result] = await connection.execute(
        `INSERT INTO properties 
         (title, description, address, price, bedrooms, bathrooms, area, property_type, landlord_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, description, address, price, bedrooms, bathrooms, area, property_type || 'apartment', req.user.id]
      );
      
      // Add images if they exist
      if (req.files && req.files.length > 0) {
        const imageValues = req.files.map((file, index) => [
          result.insertId,
          `/uploads/${file.filename}`,
          index === 0 // First image is primary
        ]);
        
        await connection.query(
          'INSERT INTO property_images (property_id, image_url, is_primary) VALUES ?',
          [imageValues]
        );
      }
      
      await connection.commit();
      
      res.status(201).json({
        message: 'Property added successfully',
        property: {
          id: result.insertId,
          title,
          description,
          address,
          price,
          bedrooms,
          bathrooms,
          area,
          property_type,
          images: req.files ? req.files.map(file => `/uploads/${file.filename}`) : []
        }
      });
    } catch (error) {
      // Rollback transaction and delete uploaded files on error
      await connection.rollback();
      if (req.files) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      throw error;
    }
  } catch (err) {
    console.error('Error creating property:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/**
 * Tenant Management Routes
 */

// Add tenant to property (landlord only)
app.post('/api/tenants', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a landlord
    if (req.user.role !== 'landlord') {
      return res.status(403).json({ message: 'Access denied. Landlords only.' });
    }
    
    const { name, email, phone, property_id, rent_amount, lease_start, lease_end } = req.body;
    
    // Validate input
    if (!name || !email || !property_id || !rent_amount || !lease_start || !lease_end) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    // Check if email already exists
    const [existingUser] = await connection.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Start transaction
    await connection.beginTransaction();
    
    try {
      // Create user account with default password
      const defaultPassword = 'Tenant@123';
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(defaultPassword, salt);
      
      const [userResult] = await connection.execute(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, "tenant")',
        [name, email, hashedPassword]
      );
      
      const user_id = userResult.insertId;
      
      // Create tenant record
      const [tenantResult] = await connection.execute(
        `INSERT INTO tenants 
         (user_id, property_id, rent_amount, lease_start, lease_end) 
         VALUES (?, ?, ?, ?, ?)`,
        [user_id, property_id, rent_amount, lease_start, lease_end]
      );
      
      // Update property status
      await connection.execute(
        'UPDATE properties SET status = "occupied" WHERE id = ?',
        [property_id]
      );
      
      await connection.commit();
      
      // Send success response with default password
      res.status(201).json({
        message: 'Tenant account created successfully',
        tenant: {
          id: tenantResult.insertId,
          name,
          email,
          phone,
          property_id,
          rent_amount,
          lease_start,
          lease_end
        },
        loginCredentials: {
          email: email,
          defaultPassword: defaultPassword
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (err) {
    console.error('Error creating tenant:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// Get tenant details including current property
app.get('/api/tenants/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id === 'current' ? req.user.id : req.params.id;
    
    // Get tenant details with property information and images
    const [rows] = await connection.execute(`
      SELECT 
        t.*,
        p.*,
        u.name as tenant_name,
        u.email as tenant_email,
        COALESCE(pi.image_url, 'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg') as image
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      JOIN users u ON t.user_id = u.id
      LEFT JOIN property_images pi ON p.id = pi.property_id AND pi.is_primary = true
      WHERE t.user_id = ?
    `, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ 
        message: 'No property assigned to this tenant'
      });
    }

    const [payments] = await connection.execute(`
      SELECT SUM(amount) as total
      FROM payments 
      WHERE tenant_id = ? 
      AND payment_status = 'completed'
      AND MONTH(payment_date) = MONTH(CURRENT_DATE())
    `, [rows[0].id]);

    const [complaints] = await connection.execute(`
      SELECT COUNT(*) as count
      FROM complaints
      WHERE tenant_id = ? AND status IN ('open', 'in_progress')
    `, [rows[0].id]);

    res.json({ 
      data: {
        tenant: {
          name: rows[0].tenant_name,
          email: rows[0].tenant_email,
          rentAmount: rows[0].rent_amount,
          leaseStart: rows[0].lease_start,
          leaseEnd: rows[0].lease_end
        },
        property: {
          id: rows[0].property_id,
          title: rows[0].title,
          address: rows[0].address,
          bedrooms: rows[0].bedrooms,
          bathrooms: rows[0].bathrooms,
          area: rows[0].area,
          image: rows[0].image
        },
        stats: {
          currentMonthPayments: payments[0].total || 0,
          activeComplaints: complaints[0].count || 0
        }
      }
    });
  } catch (err) {
    console.error('Error fetching tenant details:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all tenants for a landlord
app.get('/api/landlord/tenants', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    // Get all tenants with their property and user information
    const query = `
      SELECT 
        t.id,
        t.rent_amount,
        t.lease_start,
        t.lease_end,
        u.name,
        u.email,
        p.title as property_title,
        p.id as property_id,
        CASE 
          WHEN CURRENT_DATE() BETWEEN t.lease_start AND t.lease_end THEN 'active'
          WHEN CURRENT_DATE() > t.lease_end THEN 'expired'
          WHEN CURRENT_DATE() < t.lease_start THEN 'upcoming'
        END as status
      FROM tenants t
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON t.property_id = p.id
      WHERE p.landlord_id = ?
      ORDER BY t.created_at DESC
    `;

    const [tenants] = await connection.execute(query, [req.user.id]);

    res.json(tenants);
  } catch (err) {
    console.error('Error fetching tenants:', err);
    res.status(500).json({ 
      message: 'Failed to fetch tenants',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

/**
 * Payment History and Management Routes
 * Add this section to fix the 404 errors for /api/payments
 */

// Get payment history for current tenant
app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching payment history for user:', req.user.id);
    
    // Get tenant info
    const [tenant] = await connection.execute(
      'SELECT id, property_id FROM tenants WHERE user_id = ?',
      [req.user.id]
    );
    
    if (!tenant.length) {
      console.log('No tenant found for user:', req.user.id);
      return res.json([]); // Return empty array if no tenancy found
    }
    
    // Build base query
    let query = `
      SELECT p.*, pr.title as property_title, pr.address as property_address
      FROM payments p
      JOIN properties pr ON p.property_id = pr.id
      WHERE p.tenant_id = ?
    `;
    
    const queryParams = [tenant[0].id];
    
    // Add optional filters
    if (req.query.status) {
      query += ' AND p.payment_status = ?';
      queryParams.push(req.query.status);
    }
    
    if (req.query.method) {
      query += ' AND p.payment_method = ?';
      queryParams.push(req.query.method);
    }
    
    // Add ordering
    query += ' ORDER BY p.created_at DESC';
    
    // Handle LIMIT properly - build it into the query string instead of using parameter
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (!isNaN(limit) && limit > 0 && limit <= 1000) { // Cap at 1000 for safety
        query += ` LIMIT ${limit}`;
      }
    }
    
    console.log('Executing payments query:', {
      tenantId: tenant[0].id,
      hasStatusFilter: !!req.query.status,
      hasMethodFilter: !!req.query.method,
      hasLimit: !!req.query.limit,
      limitValue: req.query.limit
    });
    
    const [payments] = await connection.execute(query, queryParams);
    
    // Format amounts for display
    const formattedPayments = payments.map(payment => ({
      ...payment,
      formatted_amount: formatKES(payment.amount),
      payment_date_formatted: new Date(payment.payment_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }));
    
    console.log(`✅ Found ${formattedPayments.length} payments for tenant ${tenant[0].id}`);
    res.json(formattedPayments);
    
  } catch (err) {
    console.error('❌ Error fetching payment history:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// Get specific payment details
app.get('/api/payments/:id', authenticateToken, async (req, res) => {
  try {
    const paymentId = req.params.id;
    
    const [payments] = await connection.execute(`
      SELECT p.*, pr.title as property_title, pr.address as property_address, t.user_id
      FROM payments p
      JOIN properties pr ON p.property_id = pr.id
      JOIN tenants t ON p.tenant_id = t.id
      WHERE p.id = ?
    `, [paymentId]);
    
    if (!payments.length) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    
    const payment = payments[0];
    
    // Check if this payment belongs to the current user
    if (payment.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Format payment details
    const formattedPayment = {
      ...payment,
      formatted_amount: formatKES(payment.amount),
      payment_date_formatted: new Date(payment.payment_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
    
    res.json(formattedPayment);
    
  } catch (err) {
    console.error('Error fetching payment details:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// Update payment status (for landlords)
app.put('/api/payments/:id', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { payment_status, notes } = req.body;
    
    // Validate status
    const allowedStatuses = ['pending', 'completed', 'failed', 'refunded'];
    if (!allowedStatuses.includes(payment_status)) {
      return res.status(400).json({ 
        message: 'Invalid payment status',
        allowedStatuses 
      });
    }
    
    const [result] = await connection.execute(
      'UPDATE payments SET payment_status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [payment_status, notes || null, paymentId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    
    res.json({
      message: 'Payment status updated successfully',
      paymentId: paymentId,
      newStatus: payment_status
    });
    
  } catch (err) {
    console.error('Error updating payment status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
/**
 * Payment Management Routes
 */

// M-Pesa payment endpoints 

app.post('/api/payments/mpesa/initiate', authenticateToken, async (req, res) => {
  try {
    console.log('🚀 M-Pesa STK Push initiation request:', {
      user: req.user.id,
      amount: req.body.amount,
      phone: req.body.phone?.substring(0, 6) + '***', // Partial phone for privacy
      description: req.body.description
    });
    
    const { amount, phone, description } = req.body;
    
    // Enhanced validation
    if (!amount || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Amount and phone number are required'
      });
    }

    // Validate amount
    const wholeAmount = Math.floor(Number(amount));
    if (isNaN(wholeAmount) || wholeAmount < 1 || wholeAmount > 500000) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be between KES 1 and KES 500,000'
      });
    }

    // Validate and format phone number
    let formattedPhone;
    try {
      formattedPhone = mpesaService.formatPhoneNumber(phone);
      console.log('📱 Phone number formatted:', phone, '->', formattedPhone.substring(0, 6) + '***');
    } catch (phoneError) {
      console.error('❌ Phone validation failed:', phoneError.message);
      return res.status(400).json({
        success: false,
        message: `Invalid phone number: ${phoneError.message}. Please use format: 0712345678, 254712345678, or 712345678`
      });
    }

    // Get tenant info
    const [tenant] = await connection.execute(
      'SELECT id, property_id FROM tenants WHERE user_id = ?',
      [req.user.id]
    );

    if (!tenant.length) {
      return res.status(400).json({ 
        success: false,
        message: 'No active tenancy found. Please contact your landlord.' 
      });
    }

    console.log('👤 Tenant found:', { tenantId: tenant[0].id, propertyId: tenant[0].property_id });

    // Start database transaction
    await connection.beginTransaction();

    try {
      // Create payment record
      const [paymentResult] = await connection.execute(
        `INSERT INTO payments 
         (tenant_id, property_id, amount, payment_date, payment_method, payment_status, notes) 
         VALUES (?, ?, ?, CURRENT_DATE(), 'mpesa', 'pending', ?)`,
        [
          tenant[0].id, 
          tenant[0].property_id, 
          wholeAmount, 
          `STK Push to ${formattedPhone.substring(0, 6)}***`
        ]
      );

      const paymentId = paymentResult.insertId;
      console.log('💾 Payment record created with ID:', paymentId);

      // Prepare M-Pesa payment request
      const paymentRequest = {
        phone: formattedPhone,  // 📱 This is where the STK push will be sent
        amount: wholeAmount,
        accountReference: `RENT${paymentId}`,
        transactionDesc: description ? description.substring(0, 13) : `Rent${paymentId}`,
        callbackUrl: process.env.MPESA_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/payments/mpesa/callback`
      };

      console.log('📤 Sending STK Push request:', {
        phone: paymentRequest.phone.substring(0, 6) + '***',
        amount: paymentRequest.amount,
        accountReference: paymentRequest.accountReference,
        transactionDesc: paymentRequest.transactionDesc
      });

      // Initiate M-Pesa STK Push
      const mpesaResponse = await mpesaService.initiatePayment(paymentRequest);

      // Update payment record with M-Pesa details
      await connection.execute(
        'UPDATE payments SET reference_number = ?, notes = ? WHERE id = ?',
        [
          mpesaResponse.CheckoutRequestID, 
          JSON.stringify({
            merchantRequestId: mpesaResponse.MerchantRequestID,
            checkoutRequestId: mpesaResponse.CheckoutRequestID,
            responseCode: mpesaResponse.ResponseCode,
            phoneNumber: formattedPhone.substring(0, 6) + '***', // Masked for logs
            initiatedAt: new Date().toISOString()
          }), 
          paymentId
        ]
      );

      // Commit transaction
      await connection.commit();

      // Start background status checking for sandbox
      if (mpesaConfig.environment === 'sandbox') {
        console.log('⏱️ Starting background status check in 10 seconds...');
        setTimeout(async () => {
          try {
            await checkAndUpdatePaymentStatus(mpesaResponse.CheckoutRequestID, paymentId);
          } catch (error) {
            console.error('❌ Background status check error:', error.message);
          }
        }, 10000);
      }

      console.log('✅ M-Pesa payment initiated successfully:', {
        paymentId,
        phone: formattedPhone.substring(0, 6) + '***',
        amount: wholeAmount,
        merchantRequestId: mpesaResponse.MerchantRequestID
      });

      res.status(201).json({
        success: true,
        message: 'M-Pesa payment initiated successfully',
        data: {
          paymentId: paymentId,
          merchantRequestId: mpesaResponse.MerchantRequestID,
          checkoutRequestId: mpesaResponse.CheckoutRequestID,
          responseCode: mpesaResponse.ResponseCode,
          customerMessage: `STK push sent to ${formattedPhone.substring(0, 6)}***. Please check your phone and enter your M-Pesa PIN.`,
          amount: wholeAmount,
          phone: formattedPhone.substring(0, 6) + '***' // Masked for response
        }
      });

    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    }

  } catch (error) {
    console.error('❌ Error initiating M-Pesa payment:', error.message);
    
    // Provide user-friendly error messages
    let userMessage = 'Failed to initiate payment. Please try again.';
    
    if (error.message.includes('Invalid phone number')) {
      userMessage = 'Please enter a valid Kenyan phone number (e.g., 0712345678)';
    } else if (error.message.includes('Invalid Access Token')) {
      userMessage = 'Payment service temporarily unavailable. Please try again in a few moments.';
    } else if (error.message.includes('Bad Request - Invalid PhoneNumber')) {
      userMessage = 'The phone number you entered is not valid for M-Pesa. Please check and try again.';
    } else if (error.message.includes('Unable to process request')) {
      userMessage = 'M-Pesa service is temporarily unavailable. Please try again later.';
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

app.get('/api/payments/mpesa/status/:paymentId', authenticateToken, async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    
    // Get payment details
    const [payments] = await connection.execute(
      `SELECT p.*, t.user_id 
       FROM payments p 
       JOIN tenants t ON p.tenant_id = t.id 
       WHERE p.id = ?`,
      [paymentId]
    );

    if (!payments.length) {
      return res.status(404).json({ 
        success: false,
        message: 'Payment not found' 
      });
    }

    const payment = payments[0];

    // Check if this payment belongs to the current user
    if (payment.user_id !== req.user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied' 
      });
    }

    // If payment is already completed or failed, return current status
    if (payment.payment_status !== 'pending') {
      return res.json({
        success: true,
        paymentId: payment.id,
        status: payment.payment_status,
        amount: payment.amount,
        reference: payment.reference_number,
        date: payment.payment_date,
        notes: payment.notes
      });
    }

    // Check with M-Pesa if still pending (sandbox only)
    if (payment.reference_number && mpesaConfig.environment === 'sandbox') {
      try {
        await checkAndUpdatePaymentStatus(payment.reference_number, paymentId);
        
        // Get updated payment status
        const [updatedPayments] = await connection.execute(
          'SELECT * FROM payments WHERE id = ?',
          [paymentId]
        );
        
        const updatedPayment = updatedPayments[0];
        
        return res.json({
          success: true,
          paymentId: updatedPayment.id,
          status: updatedPayment.payment_status,
          amount: updatedPayment.amount,
          reference: updatedPayment.reference_number,
          date: updatedPayment.payment_date,
          notes: updatedPayment.notes
        });
      } catch (error) {
        console.error('Error checking payment status:', error);
      }
    }

    // Return current status if check failed or production
    res.json({
      success: true,
      paymentId: payment.id,
      status: payment.payment_status,
      amount: payment.amount,
      reference: payment.reference_number,
      date: payment.payment_date,
      notes: payment.notes
    });

  } catch (error) {
    console.error('Error getting payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status',
      error: error.message
    });
  }
});

// M-Pesa callback endpoint (exact format from documentation)
app.post('/api/payments/mpesa/callback', async (req, res) => {
  try {
    console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));
    
    // Process the callback using the service
    const paymentStatus = mpesaService.processCallback(req.body);
    
    // Find payment by checkout request ID
    const [payments] = await connection.execute(
      'SELECT * FROM payments WHERE reference_number = ?',
      [paymentStatus.CheckoutRequestID]
    );

    if (payments.length > 0) {
      const payment = payments[0];
      
      if (paymentStatus.ResultCode === "0") {
        // Payment successful - update with all M-Pesa details
        const updateQuery = `
          UPDATE payments 
          SET payment_status = 'completed', 
              reference_number = ?,
              notes = ?
          WHERE id = ?`;
        
        const notes = JSON.stringify({
          mpesaReceiptNumber: paymentStatus.MpesaReceiptNumber,
          transactionDate: paymentStatus.TransactionDate,
          phoneNumber: paymentStatus.PhoneNumber,
          balance: paymentStatus.Balance,
          merchantRequestId: paymentStatus.MerchantRequestID
        });
        
        await connection.execute(updateQuery, [
          paymentStatus.MpesaReceiptNumber,
          notes,
          payment.id
        ]);
        
        console.log(`Payment ${payment.id} completed successfully with receipt: ${paymentStatus.MpesaReceiptNumber}`);
      } else {
        // Payment failed - update with error details
        await connection.execute(
          'UPDATE payments SET payment_status = ?, notes = ? WHERE id = ?',
          ['failed', `Error ${paymentStatus.ResultCode}: ${paymentStatus.ResultDesc}`, payment.id]
        );
        
        console.log(`Payment ${payment.id} failed: ${paymentStatus.ResultDesc}`);
      }
    } else {
      console.warn('Received callback for unknown checkout request:', paymentStatus.CheckoutRequestID);
    }

    // Always respond with success to M-Pesa (as per documentation)
    res.json({ 
      ResultCode: 0, 
      ResultDesc: "Accepted" 
    });
    
  } catch (error) {
    console.error('Error processing M-Pesa callback:', error);
    // Still respond with success to avoid M-Pesa retries
    res.json({ 
      ResultCode: 0, 
      ResultDesc: "Accepted" 
    });
  }
});

// Regular payment recording
app.post('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { tenant_id, property_id, amount, payment_method } = req.body;
    
    const [result] = await connection.execute(
      `INSERT INTO payments 
       (tenant_id, property_id, amount, payment_date, payment_method, payment_status) 
       VALUES (?, ?, ?, CURRENT_DATE(), ?, 'completed')`,
      [tenant_id, property_id, amount, payment_method]
    );
    
    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      payment: {
        id: result.insertId,
        amount: formatKES(amount),
        date: new Date().toISOString().split('T')[0],
        status: 'completed'
      }
    });
  } catch (err) {
    console.error('Error recording payment:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

/**
 * Complaint Management Routes
 */

// Get complaints with filters
app.get('/api/complaints', authenticateToken, async (req, res) => {
  try {
    console.log('Processing complaints request for user:', req.user.id);
    
    const query = `
      SELECT c.*, p.title as property_title
      FROM complaints c
      JOIN properties p ON c.property_id = p.id
      JOIN tenants t ON c.tenant_id = t.id
      WHERE t.user_id = ?
      ORDER BY c.created_at DESC
    `;
    
    console.log('Executing complaints query with user_id:', req.user.id);
    
    const [rows] = await connection.execute(query, [req.user.id]);
    
    // Apply status filter in JavaScript if needed
    let result = rows;
    if (req.query.status && Array.isArray(req.query.status)) {
      const allowedStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      const validStatuses = req.query.status.filter(status => allowedStatuses.includes(status));
      
      if (validStatuses.length > 0) {
        result = result.filter(complaint => validStatuses.includes(complaint.status));
      }
    }
    
    // Apply limit in JavaScript if needed
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (!isNaN(limit) && limit > 0) {
        result = result.slice(0, limit);
      }
    }
    
    console.log('Complaints query result:', result.length, 'rows');
    res.json(result);
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// Submit new complaint
app.post('/api/complaints', authenticateToken, async (req, res) => {
  try {
    console.log('Processing complaint submission for user:', req.user.id);
    console.log('Request body:', req.body);
    
    const { subject, description, category } = req.body;
    
    // Validate required fields
    if (!subject || !description) {
      return res.status(400).json({ 
        message: 'Subject and description are required' 
      });
    }
    
    // Get tenant's current property and tenant ID
    const [tenant] = await connection.execute(
      'SELECT id, property_id FROM tenants WHERE user_id = ?',
      [req.user.id]
    );
    
    if (!tenant.length) {
      return res.status(400).json({ message: 'No active tenancy found' });
    }
    
    // Provide default category if not provided
    const complaintCategory = category || 'other';
    
    console.log('Inserting complaint:', {
      tenant_id: tenant[0].id,
      property_id: tenant[0].property_id,
      subject,
      description,
      category: complaintCategory
    });
    
    const [result] = await connection.execute(
      `INSERT INTO complaints 
       (tenant_id, property_id, subject, description, category, status) 
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [tenant[0].id, tenant[0].property_id, subject, description, complaintCategory]
    );
    
    console.log('Complaint inserted successfully with ID:', result.insertId);
    
    res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint: {
        id: result.insertId,
        subject,
        description,
        category: complaintCategory,
        status: 'open'
      }
    });
  } catch (err) {
    console.error('Error submitting complaint:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});



/**
 * Landlord Complaint Management Routes
 */

// Get all complaints for landlord's properties
app.get('/api/landlord/complaints', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    console.log('Fetching complaints for landlord:', req.user.id);
    
    // Build base query to get complaints for landlord's properties
    let query = `
      SELECT 
        c.*,
        u.name as tenant_name,
        p.title as property_title,
        p.address as property_address
      FROM complaints c
      JOIN tenants t ON c.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON c.property_id = p.id
      WHERE p.landlord_id = ?
    `;
    
    const queryParams = [req.user.id];
    
    // Add optional filters
    if (req.query.status && req.query.status !== 'all') {
      query += ' AND c.status = ?';
      queryParams.push(req.query.status);
    }
    
    if (req.query.category && req.query.category !== 'all') {
      query += ' AND c.category = ?';
      queryParams.push(req.query.category);
    }
    
    // Add ordering
    query += ' ORDER BY c.created_at DESC';
    
    // Handle LIMIT properly
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (!isNaN(limit) && limit > 0 && limit <= 1000) {
        query += ` LIMIT ${limit}`;
      }
    }
    
    console.log('Executing landlord complaints query:', {
      landlordId: req.user.id,
      hasStatusFilter: !!req.query.status,
      hasCategoryFilter: !!req.query.category,
      hasLimit: !!req.query.limit
    });
    
    const [complaints] = await connection.execute(query, queryParams);
    
    console.log(`✅ Found ${complaints.length} complaints for landlord ${req.user.id}`);
    res.json(complaints);
    
  } catch (err) {
    console.error('❌ Error fetching landlord complaints:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// Update complaint status (landlord only)
app.put('/api/complaints/:id', authenticateToken, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { status } = req.body;
    
    // Validate status
    const allowedStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        message: 'Invalid complaint status',
        allowedStatuses 
      });
    }
    
    // Check if user has permission to update this complaint
    if (req.user.role === 'landlord') {
      // Landlord can only update complaints for their properties
      const [complaints] = await connection.execute(`
        SELECT c.* 
        FROM complaints c
        JOIN properties p ON c.property_id = p.id
        WHERE c.id = ? AND p.landlord_id = ?
      `, [complaintId, req.user.id]);
      
      if (complaints.length === 0) {
        return res.status(404).json({ message: 'Complaint not found or access denied' });
      }
    } else if (req.user.role === 'tenant') {
      // Tenant can only view their own complaints (not update status)
      return res.status(403).json({ message: 'Tenants cannot update complaint status' });
    }
    
    const [result] = await connection.execute(
      'UPDATE complaints SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, complaintId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Complaint not found' });
    }
    
    console.log(`Complaint ${complaintId} status updated to ${status} by landlord ${req.user.id}`);
    
    res.json({
      message: 'Complaint status updated successfully',
      complaintId: complaintId,
      newStatus: status
    });
    
  } catch (err) {
    console.error('Error updating complaint status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get complaint details (both landlord and tenant can view)
app.get('/api/complaints/:id', authenticateToken, async (req, res) => {
  try {
    const complaintId = req.params.id;
    
    let query, queryParams;
    
    if (req.user.role === 'landlord') {
      // Landlord can view complaints for their properties
      query = `
        SELECT 
          c.*,
          u.name as tenant_name,
          p.title as property_title,
          p.address as property_address
        FROM complaints c
        JOIN tenants t ON c.tenant_id = t.id
        JOIN users u ON t.user_id = u.id
        JOIN properties p ON c.property_id = p.id
        WHERE c.id = ? AND p.landlord_id = ?
      `;
      queryParams = [complaintId, req.user.id];
    } else {
      // Tenant can only view their own complaints
      query = `
        SELECT 
          c.*,
          p.title as property_title,
          p.address as property_address
        FROM complaints c
        JOIN tenants t ON c.tenant_id = t.id
        JOIN properties p ON c.property_id = p.id
        WHERE c.id = ? AND t.user_id = ?
      `;
      queryParams = [complaintId, req.user.id];
    }
    
    const [complaints] = await connection.execute(query, queryParams);
    
    if (!complaints.length) {
      return res.status(404).json({ message: 'Complaint not found or access denied' });
    }
    
    res.json(complaints[0]);
    
  } catch (err) {
    console.error('Error fetching complaint details:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

/**
 * Enhanced Dashboard Routes for Landlord
 */

// Get recent complaints (updated to include more details)
app.get('/api/dashboard/recent-complaints', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20); // Cap at 20

    const query = `
      SELECT 
        c.*,
        u.name as tenant,
        p.title as property,
        p.address as property_address
      FROM complaints c
      JOIN tenants t ON c.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON c.property_id = p.id
      WHERE p.landlord_id = ?
      ORDER BY c.created_at DESC
      LIMIT ${limit}`; // Inject limit directly into query

    const [complaints] = await connection.execute(query, [req.user.id]);

    // Format the response to match expected format
    const formattedComplaints = complaints.map(complaint => ({
      ...complaint,
      date: new Date(complaint.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }));

    res.json(formattedComplaints);
  } catch (err) {
    console.error('Error fetching recent complaints:', err);
    res.status(500).json({ message: 'Failed to fetch recent complaints' });
  }
});

/**
 * Property Management Enhancement Routes
 */

// Get properties for landlord (with additional filters)
app.get('/api/landlord/properties', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    let query = `
      SELECT 
        p.*,
        COALESCE(pi.image_url, 'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg') as image,
        COUNT(DISTINCT t.id) as tenant_count,
        CASE 
          WHEN COUNT(DISTINCT t.id) > 0 THEN 'occupied'
          ELSE p.status
        END as current_status
      FROM properties p 
      LEFT JOIN property_images pi ON p.id = pi.property_id AND pi.is_primary = true
      LEFT JOIN tenants t ON p.id = t.property_id 
        AND CURRENT_DATE() BETWEEN t.lease_start AND t.lease_end
      WHERE p.landlord_id = ?
    `;
    
    const queryParams = [req.user.id];
    
    // Add filters if provided
    if (req.query.status && req.query.status !== 'all') {
      query += ' AND p.status = ?';
      queryParams.push(req.query.status);
    }
    
    if (req.query.minPrice) {
      query += ' AND p.price >= ?';
      queryParams.push(req.query.minPrice);
    }
    
    if (req.query.maxPrice) {
      query += ' AND p.price <= ?';
      queryParams.push(req.query.maxPrice);
    }
    
    // Group by property to avoid duplicates
    query += ' GROUP BY p.id ORDER BY p.created_at DESC';
    
    const [properties] = await connection.execute(query, queryParams);
    
    // Format the response
    const formattedProperties = properties.map(property => ({
      ...property,
      price: formatKES(property.price),
      tenant_count: parseInt(property.tenant_count) || 0
    }));
    
    res.json(formattedProperties);
  } catch (err) {
    console.error('Error fetching landlord properties:', err);
    res.status(500).json({ 
      message: 'Failed to fetch properties',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

/**
 * Tenant Management Enhancement Routes
 */

// Get tenant details with additional information
app.get('/api/landlord/tenants/:id', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    // Get detailed tenant information including payment and complaint history
    const [tenantDetails] = await connection.execute(`
      SELECT 
        t.*,
        u.name as tenant_name,
        u.email as tenant_email,
        p.title as property_title,
        p.address as property_address,
        p.id as property_id,
        COALESCE(pi.image_url, 'https://images.pexels.com/photos/1546168/pexels-photo-1546168.jpeg') as property_image,
        CASE 
          WHEN CURRENT_DATE() BETWEEN t.lease_start AND t.lease_end THEN 'active'
          WHEN CURRENT_DATE() > t.lease_end THEN 'expired'
          WHEN CURRENT_DATE() < t.lease_start THEN 'upcoming'
        END as lease_status
      FROM tenants t
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON t.property_id = p.id
      LEFT JOIN property_images pi ON p.id = pi.property_id AND pi.is_primary = true
      WHERE t.id = ? AND p.landlord_id = ?
    `, [tenantId, req.user.id]);

    if (!tenantDetails.length) {
      return res.status(404).json({ message: 'Tenant not found or access denied' });
    }

    const tenant = tenantDetails[0];

    // Get payment statistics
    const [paymentStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_payments,
        SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_paid,
        SUM(CASE WHEN payment_status = 'completed' 
          AND MONTH(payment_date) = MONTH(CURRENT_DATE()) 
          AND YEAR(payment_date) = YEAR(CURRENT_DATE()) 
          THEN amount ELSE 0 END) as current_month_paid,
        MAX(payment_date) as last_payment_date
      FROM payments
      WHERE tenant_id = ?
    `, [tenantId]);

    // Get complaint statistics
    const [complaintStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_complaints,
        SUM(CASE WHEN status IN ('open', 'in_progress') THEN 1 ELSE 0 END) as active_complaints,
        MAX(created_at) as last_complaint_date
      FROM complaints
      WHERE tenant_id = ?
    `, [tenantId]);

    const response = {
      tenant: {
        id: tenant.id,
        name: tenant.tenant_name,
        email: tenant.tenant_email,
        rent_amount: tenant.rent_amount,
        lease_start: tenant.lease_start,
        lease_end: tenant.lease_end,
        lease_status: tenant.lease_status,
        created_at: tenant.created_at
      },
      property: {
        id: tenant.property_id,
        title: tenant.property_title,
        address: tenant.property_address,
        image: tenant.property_image
      },
      statistics: {
        payments: {
          total_payments: paymentStats[0].total_payments || 0,
          total_paid: paymentStats[0].total_paid || 0,
          current_month_paid: paymentStats[0].current_month_paid || 0,
          last_payment_date: paymentStats[0].last_payment_date
        },
        complaints: {
          total_complaints: complaintStats[0].total_complaints || 0,
          active_complaints: complaintStats[0].active_complaints || 0,
          last_complaint_date: complaintStats[0].last_complaint_date
        }
      }
    };

    res.json(response);
  } catch (err) {
    console.error('Error fetching tenant details:', err);
    res.status(500).json({ 
      message: 'Failed to fetch tenant details',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// Remove tenant (landlord only)
app.delete('/api/landlord/tenants/:id', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    // Verify tenant belongs to landlord's property
    const [tenantCheck] = await connection.execute(`
      SELECT t.*, p.id as property_id, u.email
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      JOIN users u ON t.user_id = u.id
      WHERE t.id = ? AND p.landlord_id = ?
    `, [tenantId, req.user.id]);

    if (!tenantCheck.length) {
      return res.status(404).json({ message: 'Tenant not found or access denied' });
    }

    const tenant = tenantCheck[0];

    // Start transaction
    await connection.beginTransaction();

    try {
      // Update property status back to available
      await connection.execute(
        'UPDATE properties SET status = "available" WHERE id = ?',
        [tenant.property_id]
      );

      // Delete tenant record
      await connection.execute('DELETE FROM tenants WHERE id = ?', [tenantId]);

      // Optionally delete user account (commented out for safety)
      // await connection.execute('DELETE FROM users WHERE id = ?', [tenant.user_id]);

      await connection.commit();

      res.json({
        message: 'Tenant removed successfully',
        tenant: {
          id: tenantId,
          email: tenant.email,
          property_id: tenant.property_id
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (err) {
    console.error('Error removing tenant:', err);
    res.status(500).json({ 
      message: 'Failed to remove tenant',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

/**
 * Dashboard Routes
 */

// Get dashboard stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    let stats = {
      totalProperties: 0,
      occupiedProperties: 0,
      totalTenants: 0,
      monthlyRevenue: 0,
      yearlyRevenue: 0,
      occupancyRate: 0,
      pendingComplaints: 0
    };

    // Get property counts
    const [propertyStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied
      FROM properties 
      WHERE landlord_id = ?`, 
      [req.user.id]
    );
    
    stats.totalProperties = propertyStats[0].total || 0;
    stats.occupiedProperties = propertyStats[0].occupied || 0;
    stats.occupancyRate = stats.totalProperties > 0 
      ? Math.round((stats.occupiedProperties / stats.totalProperties) * 100) 
      : 0;

    // Get tenant count
    const [tenantStats] = await connection.execute(`
      SELECT COUNT(DISTINCT t.id) as total
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE p.landlord_id = ?`,
      [req.user.id]
    );
    stats.totalTenants = tenantStats[0].total || 0;

    // Get revenue stats
    const [revenueStats] = await connection.execute(`
      SELECT 
        SUM(CASE 
          WHEN MONTH(payment_date) = MONTH(CURRENT_DATE) 
          AND YEAR(payment_date) = YEAR(CURRENT_DATE)
          THEN amount ELSE 0 END) as monthly,
        SUM(CASE 
          WHEN YEAR(payment_date) = YEAR(CURRENT_DATE)
          THEN amount ELSE 0 END) as yearly
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN properties prop ON t.property_id = prop.id
      WHERE prop.landlord_id = ?
      AND p.payment_status = 'completed'`,
      [req.user.id]
    );
    
    stats.monthlyRevenue = revenueStats[0].monthly || 0;
    stats.yearlyRevenue = revenueStats[0].yearly || 0;

    res.json(stats);
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
});

// Get recent payments
app.get('/api/dashboard/recent-payments', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20); // Cap at 20

    const query = `
      SELECT 
        p.*,
        u.name as tenant,
        prop.title as property
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties prop ON p.property_id = prop.id
      WHERE prop.landlord_id = ?
      ORDER BY p.payment_date DESC
      LIMIT ${limit}`; // Inject limit directly into query

    const [payments] = await connection.execute(query, [req.user.id]);

    res.json(payments.map(payment => ({
      ...payment,
      amount: parseFloat(payment.amount)
    })));
  } catch (err) {
    console.error('Error fetching recent payments:', err);
    res.status(500).json({ message: 'Failed to fetch recent payments' });
  }
});

// Get recent complaints
app.get('/api/dashboard/recent-complaints', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20); // Cap at 20

    const query = `
      SELECT 
        c.*,
        u.name as tenant,
        p.title as property
      FROM complaints c
      JOIN tenants t ON c.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON c.property_id = p.id
      WHERE p.landlord_id = ?
      ORDER BY c.created_at DESC
      LIMIT ${limit}`; // Inject limit directly into query

    const [complaints] = await connection.execute(query, [req.user.id]);

    res.json(complaints);
  } catch (err) {
    console.error('Error fetching recent complaints:', err);
    res.status(500).json({ message: 'Failed to fetch recent complaints' });
  }
});

// Get landlord's payments with pagination and filters
app.get('/api/landlord/payments', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    console.log('Fetching landlord payments for user:', req.user.id);
    console.log('Query parameters:', req.query);
    
    // Parse and validate pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10)); // Cap between 1-100
    const offset = (page - 1) * limit;
    
    console.log('Pagination params:', { page, limit, offset });
    
    let query = `
      SELECT 
        p.*,
        u.name as tenant_name,
        prop.title as property_title,
        prop.address as property_address
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties prop ON p.property_id = prop.id
      WHERE prop.landlord_id = ?
    `;
    
    const queryParams = [req.user.id];

    // Add search filter if provided
    if (req.query.search && req.query.search.trim()) {
      query += ` AND (
        u.name LIKE ? OR
        prop.title LIKE ? OR
        p.reference_number LIKE ?
      )`;
      const searchTerm = `%${req.query.search.trim()}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }

    // Add date range filter if provided
    if (req.query.startDate && req.query.startDate.trim()) {
      query += ' AND p.payment_date >= ?';
      queryParams.push(req.query.startDate.trim());
    }
    
    if (req.query.endDate && req.query.endDate.trim()) {
      query += ' AND p.payment_date <= ?';
      queryParams.push(req.query.endDate.trim());
    }

    // Get total count for pagination (without LIMIT/OFFSET)
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as count_query`;
    console.log('Executing count query with params:', queryParams);
    
    const [countResult] = await connection.execute(countQuery, queryParams);
    const total = countResult[0].total;
    
    console.log('Total count:', total);

    // Add sorting and pagination to main query
    query += ' ORDER BY p.payment_date DESC';
    
    // Use direct string interpolation for LIMIT and OFFSET to avoid parameter issues
    query += ` LIMIT ${limit} OFFSET ${offset}`;
    
    console.log('Executing main query:', query);
    console.log('With params:', queryParams);

    const [payments] = await connection.execute(query, queryParams);

    console.log('Found payments:', payments.length);

    // Calculate total revenue (separate query to avoid complexity)
    const [revenueResult] = await connection.execute(
      `SELECT SUM(amount) as total_revenue 
       FROM payments p
       JOIN tenants t ON p.tenant_id = t.id
       JOIN properties prop ON t.property_id = prop.id
       WHERE prop.landlord_id = ? AND p.payment_status = 'completed'`,
      [req.user.id]
    );

    const totalRevenue = parseFloat(revenueResult[0].total_revenue || 0);
    const totalPages = Math.ceil(total / limit);

    console.log('Response summary:', {
      paymentsCount: payments.length,
      totalRevenue,
      pagination: { total, pages: totalPages, currentPage: page, limit }
    });

    res.json({
      payments: payments.map(payment => ({
        ...payment,
        amount: parseFloat(payment.amount),
        payment_date: new Date(payment.payment_date).toISOString().split('T')[0]
      })),
      pagination: {
        total,
        pages: totalPages,
        currentPage: page,
        limit
      },
      totalRevenue
    });

  } catch (err) {
    console.error('Error fetching landlord payments:', {
      error: err.message,
      code: err.code,
      sql: err.sql,
      stack: err.stack
    });
    
    res.status(500).json({
      message: 'Failed to fetch payments',
      error: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        code: err.code,
        sql: err.sql
      } : 'Internal server error'
    });
  }
});

/**
 * Report Generation API Routes
 */

// Generate payment reports
app.get('/api/reports/payments', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        p.id,
        p.amount,
        p.payment_date,
        p.payment_method,
        p.payment_status,
        p.reference_number,
        u.name as tenant_name,
        prop.title as property_title,
        prop.address as property_address
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties prop ON p.property_id = prop.id
      WHERE prop.landlord_id = ?
    `;
    
    const params = [req.user.id];
    
    // Add date filters if provided
    if (startDate) {
      query += ' AND p.payment_date >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND p.payment_date <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY p.payment_date DESC';
    
    const [results] = await connection.execute(query, params);
    
    res.json(results);
  } catch (err) {
    console.error('Error generating payment report:', err);
    res.status(500).json({ message: 'Failed to generate payment report' });
  }
});

// Generate property reports
app.get('/api/reports/properties', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id,
        p.title,
        p.address,
        p.price,
        p.bedrooms,
        p.bathrooms,
        p.area,
        p.status,
        p.created_at,
        COUNT(t.id) as tenant_count,
        SUM(CASE WHEN pay.payment_status = 'completed' THEN pay.amount ELSE 0 END) as total_revenue
      FROM properties p
      LEFT JOIN tenants t ON p.id = t.property_id
      LEFT JOIN payments pay ON p.id = pay.property_id
      WHERE p.landlord_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `;
    
    const [results] = await connection.execute(query, [req.user.id]);
    
    res.json(results);
  } catch (err) {
    console.error('Error generating property report:', err);
    res.status(500).json({ message: 'Failed to generate property report' });
  }
});

// Generate complaint reports
app.get('/api/reports/complaints', authenticateToken, checkRole('landlord'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        c.id,
        c.subject,
        c.description,
        c.category,
        c.status,
        c.created_at,
        c.updated_at,
        u.name as tenant_name,
        p.title as property_title,
        p.address as property_address
      FROM complaints c
      JOIN tenants t ON c.tenant_id = t.id
      JOIN users u ON t.user_id = u.id
      JOIN properties p ON c.property_id = p.id
      WHERE p.landlord_id = ?
    `;
    
    const params = [req.user.id];
    
    // Add date filters if provided
    if (startDate) {
      query += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND c.created_at <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY c.created_at DESC';
    
    const [results] = await connection.execute(query, params);
    
    res.json(results);
  } catch (err) {
    console.error('Error generating complaint report:', err);
    res.status(500).json({ message: 'Failed to generate complaint report' });
  }
});


/**
 * Error Handling Middleware
 * Must be defined last
 */

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    params: req.params,
    query: req.query,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  
  res.status(500).json({ 
    message: 'Something broke!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  console.log('404 - Route not found:', req.method, req.path);
  res.status(404).json({ message: 'Route not found' });
});