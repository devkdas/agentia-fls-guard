import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

function runAgentia(args: string[], timeoutMs = 120_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

function rowsOf(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return []
  const r = parsed?.result ?? parsed
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.data)) return r.data
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

interface ProfileGrants {
  profile: string
  fields: number
  objects: number
  riskyFields: string[]
  riskyObjects: string[]
  readable: boolean
}

function scanXml(xml: string, profileName: string, risky: string[]): Omit<ProfileGrants, 'profile' | 'readable'> & {readable: boolean} {
  const riskyLower = risky.map((r) => r.toLowerCase())
  const isRisky = riskyLower.some((r) => profileName.toLowerCase().includes(r))
  let fields = 0
  let objects = 0
  const riskyFields: string[] = []
  const riskyObjects: string[] = []
  const fieldRe = /<fieldPermissions>([\s\S]*?)<\/fieldPermissions>/g
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(xml)) !== null) {
    const block = m[1]
    const field = (/<field>([\s\S]*?)<\/field>/.exec(block)?.[1] ?? '').trim()
    if (field === '') continue
    fields += 1
    const granted = /<readable>\s*true\s*<\/readable>/i.test(block) || /<editable>\s*true\s*<\/editable>/i.test(block)
    if (granted && isRisky) riskyFields.push(field)
  }
  const objRe = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/g
  while ((m = objRe.exec(xml)) !== null) {
    const block = m[1]
    const object = (/<object>([\s\S]*?)<\/object>/.exec(block)?.[1] ?? '').trim()
    if (object === '') continue
    objects += 1
    const granted = /<allowRead>\s*true\s*<\/allowRead>/i.test(block) ||
      /<modifyAllRecords>\s*true\s*<\/modifyAllRecords>/i.test(block) ||
      /<viewAllRecords>\s*true\s*<\/viewAllRecords>/i.test(block)
    if (granted && isRisky) riskyObjects.push(object)
  }
  return {fields, objects, riskyFields: riskyFields.slice(0, 50), riskyObjects: riskyObjects.slice(0, 50), readable: true}
}

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default class FlsReport extends Command {
  static description =
    'Full FLS audit across profiles with CSV or JSON export for compliance. Read only.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --profile Admin --source-credential-id a11 --source-org-id 00D',
    '<%= config.bin %> <%= command.id %> --profile Guest --source-credential-id a11 --source-org-id 00D --format csv --output ./fls-audit.csv --json',
  ]

  static flags = {
    profile: Flags.string({char: 'p', description: 'Profile API name. Repeatable.', multiple: true}),
    'source-credential-id': Flags.string({description: 'Org credential ID.'}),
    'source-org-id': Flags.string({description: 'Org ID.'}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping gateway calls.'}),
    risky: Flags.string({description: 'Substring flagging a risky profile name. Repeatable.', multiple: true}),
    format: Flags.string({description: 'Export file format.', options: ['csv', 'json'], default: 'csv'}),
    output: Flags.string({char: 'o', description: 'Output file path.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(FlsReport)
    const profiles = (flags.profile as string[] | undefined) ?? []
    const sCred = (flags['source-credential-id'] as string | undefined) ?? null
    const sOrg = (flags['source-org-id'] as string | undefined) ?? null
    const pipeline = (flags['pipeline-id'] as string | undefined) ?? null
    const risky = ((flags.risky as string[] | undefined) ?? []).length > 0 ? (flags.risky as string[]) : ['guest']
    const format = ((flags.format as string) ?? 'csv') as 'csv' | 'json'
    const asJson = (flags.json as boolean) ?? false

    if (profiles.length === 0) {
      const detail = 'Pass at least one --profile to audit.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }
    if (!sCred || !sOrg) {
      const detail = 'Report mode needs --source-credential-id plus --source-org-id.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const rows: ProfileGrants[] = []
    const skipped: string[] = []
    for (const profile of profiles.slice(0, 20)) {
      try {
        const args = ['cicd', 'metadata', 'content', 'get', '--api-name', profile,
          '--metadata-type', 'Profile', '--source-credential-id', sCred, '--source-org-id', sOrg, '--json']
        if (pipeline) args.push('--pipeline-id', pipeline)
        const parsed = JSON.parse(runAgentia(args))
        const root = parsed?.result ?? parsed
        let xml: string | null = null
        if (typeof root === 'string') xml = root
        else if (typeof root === 'object' && root !== null) {
          for (const key of ['content', 'file', 'body', 'data', 'xml', 'source']) {
            const v = (root as Record<string, unknown>)[key]
            if (typeof v === 'string' && v.trim() !== '') {
              xml = v
              break
            }
          }
        }
        if (!xml) {
          skipped.push(`${profile}: empty content`)
          continue
        }
        rows.push({profile, ...scanXml(xml, profile, risky)})
      } catch (error: any) {
        skipped.push(`${profile}: ${(error?.message ?? String(error)).split('\n')[0].slice(0, 120)}`)
      }
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const outPath = resolve(process.cwd(),
      (flags.output as string | undefined) ?? `./fls-audit-${stamp}.${format}`)
    let body: string
    if (format === 'csv') {
      const lines = ['profile,fields,objects,risky_fields,risky_objects']
      for (const r of rows) {
        lines.push([r.profile, r.fields, r.objects, r.riskyFields.join('|'), r.riskyObjects.join('|')].map(csvCell).join(','))
      }
      body = lines.join('\n') + '\n'
    } else {
      body = JSON.stringify({generated: new Date().toISOString(), risky, profiles: rows, skipped}, null, 2)
    }
    writeFileSync(outPath, body, 'utf8')

    const riskyTotal = rows.reduce((n, r) => n + r.riskyFields.length + r.riskyObjects.length, 0)
    const payload = {
      status: 'complete',
      profilesScanned: rows.length,
      skipped,
      riskyTotal,
      file: outPath,
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`FLS audit complete: ${rows.length} profiles, ${riskyTotal} risky grants into ${outPath}.`)
      if (skipped.length > 0) this.log(`Skipped ${skipped.length}: ${skipped.slice(0, 5).join('; ')}.`)
    }
  }
}
