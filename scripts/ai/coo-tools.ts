import { config } from 'dotenv'
config({ path: '.env.local' })
import { adminClient } from '@repo/db/client'
import { coo } from '@repo/ai'

async function run() {
  const db = adminClient()
  const brand_id = '1e3ee34b-a674-4005-87c6-c352d8337ddf' // from logs
  
  console.log('Testing COO tool calling on buildBrandDna...')
  
  try {
    // Minimal mock payload to trigger the method profile Pass 4 which uses the matrix
    const payload = {
      form_answers: {
        brand_name_en: "Tech Innovators",
        sector: "Retail",
        arabic_dialect: "Gulf",
        brand_differentiator: "Fastest checkout in the Gulf.",
        formality_level: "casual",
        humor_tolerance: "light",
        primary_kpi_type: "engagement"
      },
      source_records: [
        {
          source_type: 'SECTOR_BASELINE',
          extracted_data: { archetype_primary: 'Hero', lifecycle_stage: 'launch', intent_state: 'grow' }
        }
      ],
      brand_post_observations: [
        { caption: "We are launching soon! #launch", likes_count: 10 }
      ],
      current_brand: {
        sector: 'Retail',
        brand_name_en: 'Test Brand'
      }
    }

    const result = await coo.buildBrandDna(payload, {
      flow_id: 'TEST-TOOLS-001',
      brand_id,
      db
    })

    console.log('\n✅ buildBrandDna Result:')
    console.log(JSON.stringify(result, null, 2))
    
    // Check if the method was derived successfully
    console.log('\n✅ Derived Method Profile:', result.method_profile?.method_name)
    
  } catch (e) {
    console.error('❌ Error during COO test:', e)
  }
}

run()
