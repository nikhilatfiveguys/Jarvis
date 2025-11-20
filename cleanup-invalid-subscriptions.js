/**
 * Script to clean up invalid subscriptions from Supabase
 * Run this to remove subscriptions that were created without payment
 */

const { createClient } = require('@supabase/supabase-js');
const SecureConfig = require('./config/secure-config');

async function cleanupInvalidSubscriptions() {
    try {
        const secureConfig = new SecureConfig();
        const supabaseConfig = secureConfig.getSupabaseConfig();
        
        if (!supabaseConfig || !supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
            console.error('❌ Supabase configuration not found');
            return;
        }
        
        const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey);
        
        console.log('🔍 Checking for subscriptions...');
        
        // Get all active subscriptions
        const { data: subscriptions, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('status', 'active');
        
        if (error) {
            console.error('❌ Error fetching subscriptions:', error);
            return;
        }
        
        console.log(`Found ${subscriptions.length} active subscriptions`);
        
        // For each subscription, verify with Polar API
        const PolarIntegration = require('./polar-integration');
        const polarIntegration = new PolarIntegration(secureConfig);
        
        let deletedCount = 0;
        
        for (const sub of subscriptions) {
            console.log(`\nChecking subscription for ${sub.email}...`);
            
            // Check if subscription exists in Polar
            try {
                if (sub.polar_subscription_id) {
                    // Try to get subscription from Polar
                    const polarSub = await polarIntegration.polar.subscriptions.get({ 
                        id: sub.polar_subscription_id 
                    });
                    
                    if (polarSub && (polarSub.status === 'active' || polarSub.status === 'trialing')) {
                        console.log(`✅ Subscription ${sub.polar_subscription_id} is valid in Polar`);
                        continue;
                    } else {
                        console.log(`⚠️ Subscription ${sub.polar_subscription_id} not active in Polar (status: ${polarSub?.status})`);
                    }
                }
                
                // If no polar_subscription_id, check by customer email
                const customer = await polarIntegration.getCustomerByEmail(sub.email);
                if (customer) {
                    const customerSubs = await polarIntegration.getSubscriptionStatus(customer.id);
                    if (customerSubs.hasActiveSubscription) {
                        console.log(`✅ Customer has active subscription in Polar`);
                        continue;
                    }
                }
                
                // No valid subscription found - mark as canceled
                console.log(`❌ No valid subscription found for ${sub.email} - marking as canceled`);
                
                const { error: updateError } = await supabase
                    .from('subscriptions')
                    .update({ 
                        status: 'canceled',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', sub.id);
                
                if (updateError) {
                    console.error(`❌ Error updating subscription ${sub.id}:`, updateError);
                } else {
                    console.log(`✅ Marked subscription ${sub.id} as canceled`);
                    deletedCount++;
                }
                
            } catch (error) {
                console.error(`❌ Error checking subscription for ${sub.email}:`, error.message);
                // If we can't verify, be conservative and don't delete
            }
        }
        
        console.log(`\n✅ Cleanup complete. Marked ${deletedCount} subscriptions as canceled.`);
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    }
}

// Run cleanup
cleanupInvalidSubscriptions();








