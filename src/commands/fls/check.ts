import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

function runAgentia(args: string[], timeoutMs = 120_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

interface Grant {
  profile: string
  kind: string
  target: string
  detail: string
}

function scanXml(xml: string, profileName: string, risky: string[]): Grant[] {
  const grants: Grant[] = []
  const riskyLower = risky.map((r) => r.toLowerCase())
  const isRisky = riskyLower.some((r) => profileName.toLowerCase().includes(r))
  const fieldRe = /<fieldPermissions>([\s\S]*?)<\/fieldPermissions>/g
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(xml)) !== null) {
    const block = m[1]
    const field = (/<field>([\s\S]*?)<\/field>/.exec(block)?.[1] ?? '').trim()
    const readable = /<readable>\s*true\s*<\/readable>/i.test(block)
    const editable = /<editable>\s*true\s*<\/editable>/i.test(block)
    if ((readable || editable) && field !== '') {
      grants.push({
        profile: profileName,
        kind: 'field',
        target: field,
        detail: `readable=${readable} editable=${editable} riskyProfile=${isRisky}`,
      })
    }
  }
  const objRe = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/g
  while ((m = objRe.exec(xml)) !== null) {
    const block = m[1]
    const object = (/<object>([\s\S]*?)<\/object>/.exec(block)?.[1] ?? '').trim()
    const allowRead = /<allowRead>\s*true\s*<\/allowRead>/i.test(block)
    const modifyAll = /<modifyAllRecords>\s*true\s*<\/modifyAllRecords>/i.test(block)
    const viewAll = /<viewAllRecords>\s*true\s*<\/viewAllRecords>/i.test(block)
    if ((allowRead || modifyAll || viewAll) && object !== '') {
      grants.push({
        profile: profileName,
        kind: 'object',
        target: object,
        detail: `allowRead=${allowRead} modifyAll=${modifyAll} viewAll=${viewAll} riskyProfile=${isRisky}`,
      })
    }
  }
  void risky
  return grants
}

function extractContent(parsed: any): string | null {
  if (parsed == null) return null
  if (typeof parsed === 'string') return parsed
  const root = parsed?.result ?? parsed
  if (typeof root === 'string') return root
  if (typeof root !== 'object') return null
  for (const key of ['content', 'file', 'body', 'data', 'xml', 'source']) {
    const v = (root as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

export default class FlsCheck extends Command {
  static description =
    'Scan a profile for field and object grants. Read only, flags risky profiles.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --profile "Guest User" --source-credential-id a11 --source-org-id 00D',
    '<%= config.bin %> <%= command.id %> --file ./Admin.profile-meta.xml --json',
  ]

  static flags = {
    profile: Flags.string({char: 'p', description: 'Profile API name to fetch from the org.'}),
    file: Flags.string({char: 'f', description: 'Local profile XML file for offline scanning.'}),
    'source-credential-id': Flags.string({description: 'Org credential ID for org mode.'}),
    'source-org-id': Flags.string({description: 'Org ID for org mode.'}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping the gateway calls.'}),
    risky: Flags.string({description: 'Substring flagging a risky profile name. Repeatable.', multiple: true}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(FlsCheck)
    const profile = (flags.profile as string | undefined) ?? null
    const file = (flags.file as string | undefined) ?? null
    const sCred = (flags['source-credential-id'] as string | undefined) ?? null
    const sOrg = (flags['source-org-id'] as string | undefined) ?? null
    const pipeline = (flags['pipeline-id'] as string | undefined) ?? null
    const risky = ((flags.risky as string[] | undefined) ?? []).length > 0
      ? (flags.risky as string[])
      : ['guest']
    const asJson = (flags.json as boolean) ?? false

    if (!profile && !file) {
      const detail = 'Pass --profile for org mode or --file for offline mode.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    let xml: string | null = null
    let profileName = profile ?? file ?? 'unknown'
    if (file) {
      try {
        xml = readFileSync(resolve(process.cwd(), file), 'utf8')
      } catch (error: any) {
        const detail = `Could not read file: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
    } else {
      if (!sCred || !sOrg) {
        const detail = 'Org mode needs --source-credential-id plus --source-org-id.'
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
      try {
        const args = ['cicd', 'metadata', 'content', 'get', '--api-name', profile as string,
          '--metadata-type', 'Profile', '--source-credential-id', sCred, '--source-org-id', sOrg, '--json']
        if (pipeline) args.push('--pipeline-id', pipeline)
        xml = extractContent(JSON.parse(runAgentia(args)))
      } catch (error: any) {
        const detail = `Profile fetch failed: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
      if (!xml) {
        const detail = 'Profile content came back empty. Cannot scan.'
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
    }

    const grants = scanXml(xml as string, profileName, risky)
    const riskyHits = grants.filter((g) => g.detail.includes('riskyProfile=true'))
    const verdict = riskyHits.length > 0 ? 'flagged' : 'clean'
    const payload = {
      status: verdict,
      profile: profileName,
      risky,
      grantCount: grants.length,
      riskyCount: riskyHits.length,
      grants: grants.slice(0, 50),
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else if (riskyHits.length === 0) {
      this.log(`Clean: ${grants.length} grants scanned on ${profileName}, none on risky profiles.`)
    } else {
      this.log(`Flagged: ${riskyHits.length} risky grants on ${profileName} out of ${grants.length} total.`)
      for (const g of riskyHits.slice(0, 15)) this.log(`  ! ${g.kind} ${g.target} (${g.detail})`)
    }
  }
}
