import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../lib/prisma.js';

/** Verifies the Bearer access token and loads the (active) user onto req.user. */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.deletedAt || user.approvalStatus !== 'approved') {
      return res.status(401).json({ error: 'Account is not active' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Role gate. Usage: authorizeRole(['admin', 'employee']) */
export function authorizeRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Row-level scope check for a client profile.
 * - admin: always allowed
 * - employee: only if the client is assigned to them
 * - client: only their own profile
 * Attaches the profile to req.clientProfile on success.
 */
export async function loadClientScope(req, res, next) {
  try {
    const clientProfileId = req.params.id || req.params.clientId;
    const userSelect = { select: { id: true, fullName: true, email: true, isActive: true } };

    // "me" alias: a client addresses their own profile without knowing its id.
    if (clientProfileId === 'me') {
      if (req.user.role !== 'client') {
        return res.status(400).json({ error: '"me" is only valid for client accounts' });
      }
      const own = await prisma.clientProfile.findUnique({
        where: { userId: req.user.id },
        include: { user: userSelect },
      });
      if (!own) return res.status(404).json({ error: 'Client profile not found' });
      req.clientProfile = own;
      return next();
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientProfileId)) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const profile = await prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      include: { user: userSelect },
    });
    if (!profile) return res.status(404).json({ error: 'Client not found' });

    const { user } = req;
    const allowed =
      user.role === 'admin' ||
      (user.role === 'employee' && profile.assignedEmployeeId === user.id) ||
      (user.role === 'client' && profile.userId === user.id);

    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    req.clientProfile = profile;
    next();
  } catch (err) {
    next(err);
  }
}
