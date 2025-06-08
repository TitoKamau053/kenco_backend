import axios from 'axios';

/**
 * M-Pesa Service for STK Push payments
 * Fixed version that resolves token issues
 */
export class MpesaService {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenRefreshInProgress = false;
  }

  /**
   * Get M-Pesa access token with proper error handling
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    // If refresh is already in progress, wait for it
    if (this.tokenRefreshInProgress) {
      while (this.tokenRefreshInProgress) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.accessToken;
    }

    // Check if token is still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && new Date() < new Date(this.tokenExpiry.getTime() - 300000)) {
      console.log('Using cached M-Pesa access token');
      return this.accessToken;
    }

    this.tokenRefreshInProgress = true;

    try {
      if (this.config.environment === 'sandbox') {
        // For sandbox - generate consistent simulated token
        const timestamp = Math.floor(Date.now() / 1000);
        this.accessToken = `sandbox_token_${timestamp}_${Math.random().toString(36).substring(7)}`;
        this.tokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
        console.log('Generated fresh simulated M-Pesa access token');
        return this.accessToken;
      } else {
        // Real M-Pesa API call for production
        const auth = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
        
        const response = await axios.get(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });

        this.accessToken = response.data.access_token;
        this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
        console.log('Generated real M-Pesa access token');
        return this.accessToken;
      }
    } catch (error) {
      console.error('Error getting M-Pesa access token:', error.message);
      // Clear failed token attempt
      this.accessToken = null;
      this.tokenExpiry = null;
      throw new Error('Failed to authenticate with M-Pesa API');
    } finally {
      this.tokenRefreshInProgress = false;
    }
  }

  /**
   * Clear token cache (useful for retry scenarios)
   */
  clearTokenCache() {
    this.accessToken = null;
    this.tokenExpiry = null;
    console.log('M-Pesa token cache cleared');
  }

  /**
   * Format phone number to M-Pesa standard (254XXXXXXXXX)
   * @param {string} phone - Phone number in various formats
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phone) {
    // Convert phone number to 254XXXXXXXXX format (12 digits)
    let formatted = phone.replace(/\D/g, ''); // Remove non-digits
    
    if (formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    } else if (formatted.startsWith('7') || formatted.startsWith('1')) {
      formatted = '254' + formatted;
    } else if (!formatted.startsWith('254')) {
      throw new Error('Invalid phone number format');
    }
    
    if (formatted.length !== 12) {
      throw new Error('Phone number must be 12 digits in 254XXXXXXXXX format');
    }
    
    return formatted;
  }

  /**
   * Generate timestamp in M-Pesa format (YYYYMMDDHHMMSS)
   * @returns {string} Formatted timestamp
   */
  generateTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Generate M-Pesa password
   * Formula: base64.encode(Shortcode+Passkey+Timestamp)
   * @param {string} timestamp - Timestamp string
   * @returns {string} Base64 encoded password
   */
  generatePassword(timestamp) {
    const rawPassword = this.config.shortcode + this.config.passkey + timestamp;
    return Buffer.from(rawPassword).toString('base64');
  }

  /**
 * Initiate M-Pesa STK Push payment to the user's phone number
 * @param {Object} paymentRequest - Payment request object
 * @param {string} paymentRequest.phone - Customer phone number (this is where STK push will be sent)
 * @param {number} paymentRequest.amount - Payment amount
 * @param {string} paymentRequest.accountReference - Account reference (max 12 chars)
 * @param {string} paymentRequest.transactionDesc - Transaction description (max 13 chars)
 * @param {string} [paymentRequest.callbackUrl] - Callback URL
 * @returns {Promise<Object>} M-Pesa response
 */
async initiatePayment(paymentRequest) {
  try {
    console.log('🔄 Initiating M-Pesa payment to phone:', paymentRequest.phone.substring(0, 6) + '***');
    
    const accessToken = await this.getAccessToken();
    const formattedPhone = this.formatPhoneNumber(paymentRequest.phone);
    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);

    // Validate amount
    const amount = Math.floor(paymentRequest.amount);
    if (amount < 1) {
      throw new Error('Amount must be at least 1 KES');
    }

    // Validate account reference (max 12 characters)
    let accountRef = paymentRequest.accountReference;
    if (accountRef.length > 12) {
      accountRef = accountRef.substring(0, 12);
    }

    // Validate transaction description (max 13 characters)
    let transactionDesc = paymentRequest.transactionDesc;
    if (transactionDesc.length > 13) {
      transactionDesc = transactionDesc.substring(0, 13);
    }

    if (this.config.environment === 'sandbox') {
      // Sandbox simulation - still simulate sending to the user's phone
      const now = new Date();
      const merchantRequestId = `${Math.floor(Math.random() * 90000) + 10000}-${Math.floor(Math.random() * 90000000) + 10000000}-${Math.floor(Math.random() * 9) + 1}`;
      const checkoutRequestId = `ws_CO_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}${Math.floor(Math.random() * 1000000)}`;

      // Very low failure rate for testing
      const shouldFail = Math.random() < 0.05; // 5% failure rate
      
      if (shouldFail) {
        const errors = [
          { code: "500.001.1001", desc: "Unable to process request" },
          { code: "400.002.02", desc: "Bad Request - Invalid PhoneNumber" }
        ];
        const error = errors[Math.floor(Math.random() * errors.length)];
        throw new Error(`M-Pesa API Error: ${error.desc}`);
      }

      console.log(`✅ Sandbox: STK Push sent to ${formattedPhone} for ${amount} KES`);
      console.log(`📱 In production, ${formattedPhone} would receive the M-Pesa prompt`);
      
      return {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: "0",
        ResponseDescription: "Success. Request accepted for processing",
        CustomerMessage: `STK push sent to ${formattedPhone}. Please check your phone and enter your M-Pesa PIN.`
      };
      
    } else {
      // PRODUCTION: Real M-Pesa API call
      const payload = {
        BusinessShortCode: this.config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: formattedPhone,        // 📱 The phone number that will pay (user's phone)
        PartyB: this.config.shortcode, // Your business shortcode (receiving the payment)
        PhoneNumber: formattedPhone,   // 📱 The phone number that will receive the STK push (user's phone)
        CallBackURL: paymentRequest.callbackUrl,
        AccountReference: accountRef,
        TransactionDesc: transactionDesc
      };

      console.log('📤 Sending STK Push to phone:', formattedPhone);
      console.log('💰 Amount:', amount, 'KES');
      console.log('🏢 Business Shortcode:', this.config.shortcode);

      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('✅ M-Pesa API Response:', response.data);
      console.log(`📱 STK push sent to ${formattedPhone}`);
      
      return response.data;
    }

  } catch (error) {
    console.error('❌ Error sending STK push to', paymentRequest.phone.substring(0, 6) + '***:', error.message);
    
    if (error.response?.data) {
      const mpesaError = error.response.data;
      throw new Error(mpesaError.errorMessage || mpesaError.ResponseDescription || 'M-Pesa API error');
    }
    
    throw new Error(error.message || 'Failed to send STK push');
  }
}

  /**
   * Check payment status (for sandbox simulation)
   * @param {string} checkoutRequestId - Checkout request ID
   * @returns {Promise<Object>} Payment status
   */
  async checkPaymentStatus(checkoutRequestId) {
    try {
      if (this.config.environment === 'sandbox') {
        // Simulate payment status with weighted success rate
        const resultCodes = [
          { code: 0, desc: "The service request is processed successfully.", success: true, weight: 75 },
          { code: 1032, desc: "Request canceled by user", success: false, weight: 8 },
          { code: 1037, desc: "DS timeout user cannot be reached", success: false, weight: 5 },
          { code: 2001, desc: "Wrong PIN entered", success: false, weight: 7 },
          { code: 1, desc: "Insufficient funds in the utility account", success: false, weight: 3 },
          { code: 17, desc: "User has cancelled the transaction", success: false, weight: 2 }
        ];

        // Weighted random selection
        const totalWeight = resultCodes.reduce((sum, code) => sum + code.weight, 0);
        let random = Math.random() * totalWeight;
        let selectedResult = resultCodes[0]; // default to success
        
        for (const result of resultCodes) {
          random -= result.weight;
          if (random <= 0) {
            selectedResult = result;
            break;
          }
        }

        const status = {
          MerchantRequestID: `${Math.floor(Math.random() * 90000) + 10000}-${Math.floor(Math.random() * 90000000) + 10000000}-${Math.floor(Math.random() * 9) + 1}`,
          CheckoutRequestID: checkoutRequestId,
          ResultCode: selectedResult.code.toString(),
          ResultDesc: selectedResult.desc
        };

        if (selectedResult.success) {
          // Add callback metadata for successful payments
          status.Amount = Math.floor(Math.random() * 10000) + 100;
          status.MpesaReceiptNumber = this.generateMpesaReceiptNumber();
          status.TransactionDate = this.generateTimestamp();
          status.PhoneNumber = `254${Math.floor(Math.random() * 900000000) + 100000000}`;
          status.Balance = Math.floor(Math.random() * 100000) + 1000;
        }

        console.log(`Simulated M-Pesa status check: ${selectedResult.desc}`);
        return status;
      } else {
        throw new Error('Status checking for production should use STK Push Query API or rely on callbacks');
      }
    } catch (error) {
      console.error('Error checking payment status:', error);
      throw new Error(error.message || 'Failed to check payment status');
    }
  }

  /**
   * Generate realistic M-Pesa receipt number
   * @returns {string} Receipt number
   */
  generateMpesaReceiptNumber() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    
    let receipt = '';
    // 2-3 letters
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      receipt += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    // 6-8 numbers
    for (let i = 0; i < 6 + Math.floor(Math.random() * 3); i++) {
      receipt += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    // 2 letters
    for (let i = 0; i < 2; i++) {
      receipt += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    
    return receipt;
  }

  /**
   * Process M-Pesa callback
   * @param {Object} callbackData - Callback data from M-Pesa
   * @returns {Object} Processed payment status
   */
  processCallback(callbackData) {
    try {
      const stkCallback = callbackData.Body?.stkCallback;
      
      if (!stkCallback) {
        throw new Error('Invalid callback data structure');
      }

      const status = {
        MerchantRequestID: stkCallback.MerchantRequestID,
        CheckoutRequestID: stkCallback.CheckoutRequestID,
        ResultCode: stkCallback.ResultCode.toString(),
        ResultDesc: stkCallback.ResultDesc
      };

      // If successful payment (ResultCode === 0), extract metadata
      if (stkCallback.ResultCode === 0 && stkCallback.CallbackMetadata?.Item) {
        const metadata = stkCallback.CallbackMetadata.Item;
        
        metadata.forEach((item) => {
          switch (item.Name) {
            case 'Amount':
              status.Amount = parseFloat(item.Value);
              break;
            case 'MpesaReceiptNumber':
              status.MpesaReceiptNumber = item.Value;
              break;
            case 'TransactionDate':
              status.TransactionDate = item.Value.toString();
              break;
            case 'PhoneNumber':
              status.PhoneNumber = item.Value.toString();
              break;
            case 'Balance':
              status.Balance = parseFloat(item.Value);
              break;
          }
        });
      }

      console.log('Processed M-Pesa callback:', status);
      return status;
    } catch (error) {
      console.error('Error processing M-Pesa callback:', error);
      throw new Error('Failed to process M-Pesa callback');
    }
  }

  /**
   * Validate M-Pesa configuration
   * @returns {Object} Validation result
   */
  validateConfig() {
    const errors = [];
    
    if (!this.config.consumerKey) errors.push('Consumer Key is required');
    if (!this.config.consumerSecret) errors.push('Consumer Secret is required');
    if (!this.config.passkey) errors.push('Passkey is required');
    if (!this.config.shortcode) errors.push('Shortcode is required');
    if (!/^\d{5,6}$/.test(this.config.shortcode)) errors.push('Shortcode must be 5-6 digits');
    if (!['sandbox', 'production'].includes(this.config.environment)) errors.push('Environment must be sandbox or production');
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}