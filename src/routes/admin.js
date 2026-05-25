const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const jwt = require('jsonwebtoken');

// Middleware to verify admin
const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token manquant' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès admin requis' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token invalide' });
  }
};

// Setup admin (public)
router.post('/setup', async (req, res) => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    
    if (adminExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Un administrateur existe déjà' 
      });
    }
    
    const admin = await User.create({
      name: 'Administrateur',
      email: process.env.ADMIN_EMAIL || 'admin@baoltech.com',
      password: process.env.ADMIN_PASSWORD || 'Admin123456',
      role: 'admin'
    });
    
    res.json({
      success: true,
      message: 'Administrateur créé avec succès',
      admin: {
        email: admin.email,
        password: process.env.ADMIN_PASSWORD || 'Admin123456'
      }
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create product (protected admin)
router.post('/products', verifyAdmin, async (req, res) => {
  try {
    const { name, price, description, category, stock, featured } = req.body;
    
    const product = await Product.create({
      name,
      price,
      description,
      category,
      stock: Number(stock),
      featured: featured === 'true'
    });
    
    res.status(201).json({ success: true, product });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Get all products (public - déjà dans products.js mais ajoutons ici aussi)
router.get('/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;