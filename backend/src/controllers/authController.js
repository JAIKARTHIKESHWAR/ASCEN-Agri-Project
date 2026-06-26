/**
 * Endpoint 12: POST /api/auth/login
 */
export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Standard demonstration accounts
  const USERS = [
    { id: 1, email: 'admin@acsen.com', name: 'Admin User', role: 'admin', pass: 'admin123' },
    { id: 7, email: 'user@acsen.com', name: 'Gunasekaran', role: 'viewer', pass: 'acsen123' }
  ];

  const matchedUser = USERS.find(u => u.email.toLowerCase() === email.toLowerCase() && u.pass === password);

  if (!matchedUser) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Generate a mock JWT-style token (base64 encoded JSON string)
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({
    id: matchedUser.id,
    name: matchedUser.name,
    role: matchedUser.role,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64');
  const token = `${header}.${payload}.mocksignature`;

  res.json({
    token,
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      role: matchedUser.role
    },
    expiresIn: 3600
  });
}
