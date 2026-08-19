import mongoose from 'mongoose';

export const connectDB = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not configured');
        }
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000),
            connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 5000),
            maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
        });
        console.log('MongoDB connection SUCCESS');
        return mongoose.connection;
    } catch (error) {
        console.error('MongoDB connection FAIL');
        console.error(error);
        process.exit(1);
    }
};
