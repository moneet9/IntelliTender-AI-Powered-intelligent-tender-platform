import jwt from 'jsonwebtoken';

const auth = (roles = []) => {
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        try {
            const authHeader = req.header('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ message: 'No auth token, access denied' });
            }
            const token = authHeader.replace('Bearer ', '');

            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
            req.user = decoded; // Contains id and role

            if (roles.length && !roles.includes(req.user.role)) {
                return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
            }

            next();
        } catch (err) {
            res.status(401).json({ message: 'Token is not valid' });
        }
    };
};

export default auth;