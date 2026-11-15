/**
 * reset_neon.js — Drop all tenant company schemas and clear app_settings
 * Run: node scripts/reset_neon.js
 * WARNING: This is DESTRUCTIVE. All company data will be lost.
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('[ERROR] DATABASE_URL environment variable is required to run reset_neon.js.');
    console.error('Example: DATABASE_URL="postgresql://user:pass@host/db" node scripts/reset_neon.js');
    process.exit(1);
}

async function resetDatabase() {
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();

    try {
        console.log('Finding all tenant schemas (t_*)...');
        const result = await client.query(
            `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 't\\_%' ESCAPE '\\'`
        );

        const schemas = result.rows.map(r => r.schema_name);
        console.log(`Found ${schemas.length} tenant schema(s): ${schemas.join(', ') || 'none'}`);

        // Drop each tenant schema
        for (const schema of schemas) {
            await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            console.log(`Dropped schema: ${schema}`);
        }

        // Drop the companies table from public schema
        await client.query(`DROP TABLE IF EXISTS public.companies CASCADE`);
        console.log('Dropped public.companies table');

        // Clear app_settings in public schema
        await client.query(`DELETE FROM public.app_settings WHERE setting_key IN ('business_name', 'business_location', 'business_contact', 'business_color', 'emp_prefix', 'company_logo')`);
        console.log('Cleared app_settings (branding reset to default)');

        console.log('\nDatabase reset complete! The app is now clean and ready for fresh onboarding.');
    } catch (err) {
        console.error('Error during reset:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

resetDatabase();
