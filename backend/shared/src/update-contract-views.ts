import * as admin from 'firebase-admin'
import {
  createSupabaseDirectClient,
  SupabaseDirectClient,
} from 'shared/supabase/init'
import { GCPLog, log as oldLog } from 'shared/utils'
import { uniq } from 'lodash'

export async function updateContractViews(log: GCPLog = oldLog) {
  const firestore = admin.firestore()
  const pg = createSupabaseDirectClient()
  log('Loading contract data...')
  const contractsToViews = Object.fromEntries(
    await pg.map(`select views, id from contracts`, [], (r) => [r.id, r.views])
  )
  const contractIds = Object.keys(contractsToViews)
  log(`Loaded ${contractIds.length} contracts.`)

  log('Computing views...')
  const views = await getViews(pg)

  log('Computing view updates...')
  let writes = 0
  const writer = firestore.bulkWriter()
  for (const contractId of contractIds) {
    const update = {
      views: views[contractId] ?? 0,
    }

    if (contractsToViews[contractId] !== update.views) {
      const contractDoc = firestore.collection('contracts').doc(contractId)
      writer.update(contractDoc, update)
      writes++
    }
  }

  log(`Committing ${writes} writes...`)
  await writer.close()
  log('Done.')
}

const getViews = async (pg: SupabaseDirectClient) => {
  const [signedInViews, signedOutViews] = await Promise.all([
    getSignedInViews(pg),
    getSignedOutViews(pg),
  ])
  return Object.fromEntries(
    uniq(Object.keys(signedInViews).concat(Object.keys(signedOutViews))).map(
      (contractId) => [
        contractId,
        Number(signedInViews[contractId] ?? 0) +
          Number(signedOutViews[contractId] ?? 0),
      ]
    )
  )
}
const getSignedInViews = async (pg: SupabaseDirectClient) => {
  return Object.fromEntries(
    await pg.map(
      `select
         contract_id,
         count(*) as logged_in_user_seen_markets_count
     from
         user_seen_markets
     where type = 'view market'
     group by
         contract_id;
    `,
      [],
      (r) => [r.contract_id, r.logged_in_user_seen_markets_count]
    )
  )
}
const getSignedOutViews = async (pg: SupabaseDirectClient) => {
  return Object.fromEntries(
    await pg.map(
      `select
         contract_id,
         count(*) as logged_out_user_seen_markets_count
     from
         user_events
     where
       name = 'view market'
       and user_id is null
     group by
         contract_id;
    `,
      [],
      (r) => [r.contract_id, r.logged_out_user_seen_markets_count]
    )
  )
}
