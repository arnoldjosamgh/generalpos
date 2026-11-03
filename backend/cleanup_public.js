/**
 * cleanup_public.js
 * Clean up orphaned tenant orders that were mistakenly written to `public` schema.
 */
const { Pool } = require('pg');
const fs = require('fs'), path = require('path');
fs.readFileSync(path.join(__dirname,'..', '.env'),'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([^#=]+)=(.*)/);if(m)process.env[m[1].trim()]=m[2].trim();});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Identify orders in public to delete:
    // All orders where cashier_id != 9999 (tenant employees) PLUS order 32 (stale COD test order from Oct 17)
    const ordersRes = await client.query(`
      SELECT id, cashier_id, payment_method, invoice_number, transaction_id, total_amount, order_date
      FROM public.pos_orders
      WHERE cashier_id != 9999 OR (id = 32 AND payment_method = 'COD')
      ORDER BY id
    `);
    console.log(`Found ${ordersRes.rows.length} orders in public to clean up:`);
    ordersRes.rows.forEach(r => console.log('  ', JSON.stringify(r)));

    const orderIds = ordersRes.rows.map(r => r.id);
    const txIds = ordersRes.rows.map(r => r.transaction_id).filter(Boolean);

    if (orderIds.length > 0) {
      // Delete order_items
      const delItems = await client.query(`DELETE FROM public.order_items WHERE pos_order_id = ANY($1)`, [orderIds]);
      console.log(`Deleted ${delItems.rowCount} order_items from public`);

      // Delete credit_records if any
      const delCredits = await client.query(`DELETE FROM public.credit_records WHERE pos_order_id = ANY($1)`, [orderIds]).catch(() => ({ rowCount: 0 }));
      console.log(`Deleted ${delCredits.rowCount || 0} credit_records from public`);

      // Delete deliveries if any
      const delDeliv = await client.query(`DELETE FROM public.deliveries WHERE order_id = ANY($1)`, [orderIds]).catch(() => ({ rowCount: 0 }));
      console.log(`Deleted ${delDeliv.rowCount || 0} deliveries from public`);

      // Delete pos_orders
      const delOrders = await client.query(`DELETE FROM public.pos_orders WHERE id = ANY($1)`, [orderIds]);
      console.log(`Deleted ${delOrders.rowCount} pos_orders from public`);
    }

    if (txIds.length > 0) {
      // Delete transactions
      const delTx = await client.query(`DELETE FROM public.transactions WHERE id = ANY($1)`, [txIds]);
      console.log(`Deleted ${delTx.rowCount} transactions from public`);
    }

    // Verify remaining in public
    const remainingOrders = await client.query(`SELECT count(*) cnt FROM public.pos_orders`);
    const remainingPending = await client.query(`
      SELECT count(*) cnt
      FROM public.pos_orders p
      JOIN public.transactions t ON p.transaction_id = t.id
      WHERE p.payment_method = 'COD' AND t.payment_status = 'PENDING'
    `);
    console.log(`Remaining in public.pos_orders: ${remainingOrders.rows[0].cnt} total, ${remainingPending.rows[0].cnt} pending COD`);

    await client.query('COMMIT');
    console.log('✅ Cleanup committed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during cleanup, rolled back:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
