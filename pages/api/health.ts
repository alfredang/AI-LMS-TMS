import type { NextApiRequest, NextApiResponse } from 'next'

interface HealthResponse {
  status: 'ok'
  timestamp: string
  version: string
  database?: 'connected' | 'disconnected'
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    })
  }

  try {
    // Basic health check
    let dbStatus: 'connected' | 'disconnected' = 'disconnected'
    
    try {
      // Try to import and test database connection
      const pool = (await import('../../lib/db')).default
      const client = await pool.connect()
      await client.query('SELECT 1')
      client.release()
      dbStatus = 'connected'
    } catch (error) {
      console.warn('Database health check failed:', error)
      dbStatus = 'disconnected'
    }

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database: dbStatus
    })
  } catch (error) {
    console.error('Health check error:', error)
    res.status(500).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    })
  }
}
