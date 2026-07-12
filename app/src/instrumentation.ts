export async function register() {
  // Skal være et positivt guard med importen INDENI blokken: webpack fjerner
  // kun den døde gren (og dermed pg/Node-moduler i edge-buildet) på denne form
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSchema } = await import('./lib/schema')
    await ensureSchema()
  }
}
