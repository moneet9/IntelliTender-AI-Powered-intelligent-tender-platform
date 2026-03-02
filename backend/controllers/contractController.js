import { Contract } from '../models/model.js';

export const getContracts = async (req, res) => {
    try {
        const contracts = await Contract.find().populate('tenderId vendorId', 'title name email');
        res.json(contracts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getContractById = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id).populate('tenderId vendorId', 'title name email');
        if (!contract) return res.status(404).json({ message: 'Contract not found' });
        res.json(contract);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const updateContractStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Awarded', 'Signed', 'Completed'].includes(status)) {
            return res.status(400).json({ message: 'Invalid contract status' });
        }

        const contract = await Contract.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );

        if (!contract) return res.status(404).json({ message: 'Contract not found' });
        res.json(contract);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
