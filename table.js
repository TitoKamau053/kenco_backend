// verify-tables.js - Check if existing tables match application requirements
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const verifyTables = async () => {
  let connection;
  try {
    console.log('🔍 Verifying database table structures...');
    
    connection = await createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false
      } : false,
      connectTimeout: 60000
    });

    // Required table structures
    const requiredTables = {
      users: ['id', 'name', 'email', 'password', 'role', 'created_at'],
      properties: ['id', 'title', 'description', 'address', 'price', 'bedrooms', 'bathrooms', 'area', 'status', 'landlord_id', 'created_at'],
      tenants: ['id', 'user_id', 'property_id', 'rent_amount', 'lease_start', 'lease_end', 'created_at'],
      payments: ['id', 'tenant_id', 'property_id', 'amount', 'payment_date', 'payment_method', 'payment_status', 'reference_number', 'notes', 'created_at'],
      complaints: ['id', 'tenant_id', 'property_id', 'subject', 'description', 'category', 'status', 'created_at', 'updated_at'],
      property_images: ['id', 'property_id', 'image_url', 'is_primary', 'created_at']
    };

    console.log('\n📋 Checking table structures:\n');

    for (const [tableName, requiredColumns] of Object.entries(requiredTables)) {
      try {
        const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
        const existingColumns = columns.map(col => col.Field);
        
        console.log(`\n✅ Table: ${tableName}`);
        console.log(`   Existing columns: ${existingColumns.join(', ')}`);
        
        // Check for missing columns
        const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
        if (missingColumns.length > 0) {
          console.log(`   ⚠️  Missing columns: ${missingColumns.join(', ')}`);
        } else {
          console.log(`   ✅ All required columns present`);
        }
        
        // Check for extra columns (just informational)
        const extraColumns = existingColumns.filter(col => !requiredColumns.includes(col));
        if (extraColumns.length > 0) {
          console.log(`   ℹ️  Extra columns: ${extraColumns.join(', ')}`);
        }
        
      } catch (error) {
        console.log(`❌ Table ${tableName} not found or error: ${error.message}`);
      }
    }

    // Check for any missing tables
    const [tables] = await connection.execute('SHOW TABLES');
    const existingTables = tables.map(table => Object.values(table)[0]);
    const missingTables = Object.keys(requiredTables).filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log(`\n❌ Missing tables: ${missingTables.join(', ')}`);
    } else {
      console.log('\n✅ All required tables exist');
    }

    // Test a few critical queries that your app uses
    console.log('\n🧪 Testing critical queries...');
    
    try {
      // Test user query
      const [users] = await connection.execute('SELECT COUNT(*) as count FROM users');
      console.log(`✅ Users table: ${users[0].count} records`);
      
      // Test properties query
      const [properties] = await connection.execute('SELECT COUNT(*) as count FROM properties');
      console.log(`✅ Properties table: ${properties[0].count} records`);
      
      // Test join query (used in dashboard)
      const [joinTest] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM properties p 
        LEFT JOIN tenants t ON p.id = t.property_id
      `);
      console.log(`✅ Join query test: ${joinTest[0].count} property records`);
      
    } catch (queryError) {
      console.log(`❌ Query test failed: ${queryError.message}`);
    }

    console.log('\n🎉 Database verification complete!');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

verifyTables();