#!/usr/bin/env node
// Script to set Perplexity API key in Supabase Secrets
// Run with: node set-supabase-secret.js

const { execSync } = require('child_process');

const PPLX_API_KEY = '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';

console.log('🔐 Setting Perplexity API key in Supabase Secrets...\n');

try {
    // Check if supabase CLI is installed
    try {
        execSync('which supabase', { stdio: 'ignore' });
    } catch {
        console.log('❌ Supabase CLI not found.');
        console.log('\n📋 Please install it first:');
        console.log('   npm install -g supabase');
        console.log('\n   OR set it manually via Supabase Dashboard:');
        console.log('   1. Go to: https://supabase.com/dashboard');
        console.log('   2. Select project: nbmnbgouiammxpkbyaxj');
        console.log('   3. Go to: Settings > Edge Functions > Secrets');
        console.log('   4. Add secret:');
        console.log(`      Key: PPLX_API_KEY`);
        console.log(`      Value: ${PPLX_API_KEY}`);
        process.exit(1);
    }

    // Try to set the secret
    console.log('Setting PPLX_API_KEY secret...');
    execSync(`supabase secrets set PPLX_API_KEY=${PPLX_API_KEY}`, {
        stdio: 'inherit',
        env: {
            ...process.env,
            SUPABASE_PROJECT_ID: 'nbmnbgouiammxpkbyaxj'
        }
    });
    
    console.log('\n✅ Successfully set PPLX_API_KEY in Supabase Secrets!');
    console.log('\n💡 You may need to restart your Edge Function for changes to take effect.');
    
} catch (error) {
    console.error('\n❌ Error setting secret:', error.message);
    console.log('\n📋 Alternative: Set it manually via Supabase Dashboard:');
    console.log('   1. Go to: https://supabase.com/dashboard');
    console.log('   2. Select project: nbmnbgouiammxpkbyaxj');
    console.log('   3. Go to: Settings > Edge Functions > Secrets');
    console.log('   4. Click "Add new secret"');
    console.log('   5. Add:');
    console.log(`      Key: PPLX_API_KEY`);
    console.log(`      Value: ${PPLX_API_KEY}`);
    console.log('   6. Click "Save"');
    process.exit(1);
}

