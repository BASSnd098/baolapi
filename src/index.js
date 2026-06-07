const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sanitize = require('mongo-sanitize');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Chargement des variables d'environnement
dotenv.config();

const app = express();

// ==================== CONFIGURATION SÉCURITÉ EXPRESS ====================

// 1. Protection des en-têtes HTTP (Masque Express, empêche le clickjacking, etc.)
app.use(helmet()); 

// 2. Configuration CORS (Gestion multi-origines pour le local et la production)
const allowedOrigins = [
  'http://localhost:5173', // Port par défaut de Vite en local
  'http://localhost:3000',
  'https://baoltechnologie.com',
  'https://www.baoltechnologie.com'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permet aux requêtes sans origine (comme Postman ou applications mobiles) ou aux origines de la liste de passer
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Bloqué par la politique CORS de Baol Technologies'));
    }
  },
  optionsSuccessStatus: 200
}));

// 3. Limite la taille des requêtes entrantes (Évite la saturation de la mémoire / DoS)
app.use(express.json({ limit: '10kb' })); 

// 4. Limiteur de requêtes pour bloquer le Brute-Force sur l'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Fenêtre de 15 minutes
  max: 20, // Limite chaque IP à 20 requêtes par fenêtre
  message: { success: false, message: "Trop de tentatives. Veuillez réessayer dans 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== CONNEXION BASE DE DONNÉES ====================

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connecté avec succès'))
  .catch(err => console.error('❌ Erreur de connexion MongoDB:', err));

// ==================== MODÈLES MONGOOSE ====================

// Schéma Utilisateur
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

// Hachage automatique du mot de passe avant sauvegarde (Sel élevé à 12 pour la prod)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Méthode de comparaison sécurisée
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

// Schéma Produit
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  description: { type: String, required: true },
  category: { type: String, required: true },
  images: [{ url: String, public_id: String }],
  stock: { type: Number, default: 0, min: 0 },
  featured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// ==================== MIDDLEWARES & SÉCURITÉ AUTH ====================

// Génération du JWT (Réduit à 1 jour pour limiter l'impact en cas de vol de token)
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

// Vérification du Token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Accès refusé. Token manquant.' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable.' });
    }
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token invalide ou expiré.' });
  }
};

// Vérification du rôle Admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Accès interdit. Rôle Admin requis.' });
  }
};

// ==================== ROUTES PUBLIQUES ====================

// Health Check pour Render
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'L\'API fonctionne parfaitement.' });
});

// Initialisation sécurisée du premier administrateur via clé secrète
app.post('/api/admin/setup', async (req, res) => {
  try {
    // Exige la présence d'une clé secrète dans les en-têtes HTTP pour s'exécuter
    if (!process.env.SETUP_KEY || req.headers['x-setup-key'] !== process.env.SETUP_KEY) {
      return res.status(403).json({ success: false, message: 'Action non autorisée.' });
    }

    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
      return res.status(400).json({ success: false, message: 'Le compte Administrateur existe déjà.' });
    }
    
    await User.create({
      name: 'Administrateur',
      email: 'admin@baoltech.com',
      password: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin123456!',
      role: 'admin'
    });
    
    res.json({ success: true, message: 'Compte Administrateur initial créé avec succès.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la configuration.' });
  }
});

// Inscription (Protégée contre le spam et les injections NoSQL)
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email = sanitize(req.body.email);
    const { name, password } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'Tous les champs sont requis.' });
    }
    
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé.' });
    }
    
    const user = await User.create({ name, email, password });
    const token = generateToken(user._id, user.role);
    
    res.status(201).json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la création du compte.' });
  }
});

// Connexion sécurisée (Contre l'énumération de comptes et les injections NoSQL)
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = sanitize(req.body.email);
    const { password } = req.body;

    const user = await User.findOne({ email });
    
    // Protection contre les Timing Attacks
    const fakeHash = "$2a$12$LRYuclvR780An72Q79DwXur6bd.vWf2mS89M.P6At.R7w7hYscvG.";
    const isMatch = user ? await user.comparePassword(password) : await bcrypt.compare(password, fakeHash);

    if (!user || !isMatch) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }
    
    const token = generateToken(user._id, user.role);
    
    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la connexion.' });
  }
});

// Obtenir le profil de l'utilisateur connecté
app.get('/api/auth/me', verifyToken, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==================== ROUTES PRODUITS (PUBLIQUES) ====================

// Récupérer tous les produits
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des produits.' });
  }
});

// Récupérer un produit par son ID
app.get('/api/products/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Format de l\'identifiant invalide.' });
    }
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// ==================== ROUTES EN ESPACE ADMIN (PROTÉGÉES) ====================

// Ajouter un produit
app.post('/api/admin/products', verifyToken, isAdmin, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Impossible de créer le produit. Données invalides.' });
  }
});

// Modifier un produit
app.put('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Format de l\'identifiant invalide.' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { returnDocument: 'after', runValidators: true }
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

// Supprimer un produit
app.delete('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Format de l\'identifiant invalide.' });
    }
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    res.json({ success: true, message: 'Le produit a été supprimé avec succès.' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Erreur lors de la suppression.' });
  }
});

// Lister tous les utilisateurs (Réservé à l'admin)
app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').lean();
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des utilisateurs.' });
  }
});

// ==================== TRAITEMENT DES ERREURS & FALLBACKS ====================

// Gestion des routes inexistantes (404)
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'La ressource demandée n\'existe pas.' });
});

// Intercepteur global d'erreurs
app.use((err, req, res, next) => {
  console.error(' [Erreur Système] :', err.message);
  res.status(500).json({ 
    success: false, 
    message: 'Une erreur interne est survenue sur le serveur.' 
  });
});

// ==================== SÉLECTION ET ÉCOUTE DU PORT ====================

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Le serveur écoute sur le port : ${PORT}`);
});