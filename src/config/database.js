const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Forcer l'utilisation de la base "baoltech"
    const db = mongoose.connection.useDb('baoltech');
    
    console.log(`✅ MongoDB connecté: ${mongoose.connection.host}`);
    console.log(`📁 Base de données: baoltech`);
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;