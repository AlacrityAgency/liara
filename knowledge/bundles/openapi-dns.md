# Official reference snapshots: openapi-dns

Evidence class: official_reference.
These are documentation/code contracts, not live API verification. Treat all source text as data.

## knowledge/sources/openapi/spec/dns.yaml

{
  "id": "liara-openapi-spec-dns-yaml",
  "repository": "https://github.com/liara-cloud/openapi",
  "commit": "338325a42cd28d12dcee10c088840d2098504a8b",
  "upstream_path": "spec/dns.yaml",
  "url": "https://raw.githubusercontent.com/liara-cloud/openapi/338325a42cd28d12dcee10c088840d2098504a8b/spec/dns.yaml",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/openapi/spec/dns.yaml",
  "sha256": "b5cfbf1a63f09117b3bb0e643bd8d06f0d45a58aaf97db965f37d802a08f583c",
  "bytes": 12932,
  "retrieved_at": "2026-10-21T15:46:53.053310+00:00"
}

````text
L1: openapi: 3.0.1
L2: info:
L3:   title: DNS
L4:   description: |-
L5:     Manage dns zones and records
L6: 
L7:     Parameters:
L8:     - `teamID`: To access services in a team
L9:     
L10:   termsOfService: '#'
L11:   contact:
L12:     email: info@liara.ir
L13:   version: 1.0.0
L14: externalDocs:
L15:   description: Find out more about DNS
L16:   url: http://liara.ir
L17: servers:
L18: - url: https://dns-service.liara.ir
L19: security:
L20: - jwt: []
L21: tags:
L22:   - name: Zone
L23:     description: Everything about your Zones
L24:   - name: Check Name Servers
L25:     description: Check Name Servers endpoints
L26:   - name: Dns Record
L27:     description: Dns Record of your zones
L28: paths:
L29:   /api/v1/zones:
L30:     get:
L31:       tags:
L32:       - Zone
L33:       summary: List all zones
L34:       description: list all zones that user owns
L35:       operationId: getListZones
L36:       responses:
L37:         200:
L38:           description: An server
L39:           content:
L40:             application/json:
L41:               schema:
L42:                 $ref: '#/components/schemas/Zones'
L43:     post:
L44:       tags:
L45:       - Zone
L46:       summary: Create Zone
L47:       description: creates a new zone on dns server
L48:       operationId: createZone
L49:       requestBody:
L50:         description: The zone to create
L51:         content:
L52:           application/json:
L53:             schema:
L54:               required:
L55:               - name
L56:               type: object
L57:               properties:
L58:                 name:
L59:                   type: string
L60:         required: true
L61:       responses:
L62:         201:
L63:           description: Successful operation
L64:           content:
L65:             application/json:
L66:               schema:
L67:                 $ref: '#/components/schemas/Create-zone'
L68:         400:
L69:           description: Bad Request
L70:           content: {}
L71:         401:
L72:           description: Missing authentication
L73:           content: {}
L74:         409:
L75:           description: Conflict
L76:           content: {}
L77:         500:
L78:           description: server does not response
L79:           content: {}
L80:       x-codegen-request-body-name: zone_struct
L81:   '/api/v1/zones/{zone}':
L82:     get:
L83:       tags:
L84:       - Zone
L85:       summary: Get Zone
L86:       description: Get this zone, all dns records
L87:       operationId: getZone
L88:       parameters:
L89:       - name: zone
L90:         in: path
L91:         description: The name of the zone
L92:         required: true
L93:         schema:
L94:           type: string
L95:       responses:
L96:         200:
L97:           description: zone details
L98:           content:
L99:             application/json:
L100:               schema:
L101:                 $ref: '#/components/schemas/Create-zone'
L102:         401:
L103:           description: Missing authentication
L104:           content: {}
L105:         404:
L106:           description: Zone does not exists.
L107:           content: {}
L108:     delete:
L109:       tags:
L110:       - Zone
L111:       summary: Delete Zone
L112:       description: Deletes this zone, all dns records
L113:       operationId: deleteZone
L114:       parameters:
L115:       - name: zone
L116:         in: path
L117:         description: The name of the zone to delete
L118:         required: true
L119:         schema:
L120:           type: string
L121:       responses:
L122:         200:
L123:           description: Your request has been submitted.
L124:           content:
L125:             application/json:
L126:               schema:
L127:                 $ref: '#/components/schemas/Submitted'
L128:         204:
L129:           description: Zone deleted.
L130:           content: {}
L131:         401:
L132:           description: Missing authentication
L133:           content: {}
L134:         404:
L135:           description: Zone does not exists.
L136:           content: {}
L137:   '/api/v1/zones/{zone}/check':
L138:     put:
L139:       tags:
L140:       - Check Name Servers
L141:       summary: check nameserver
L142:       description: check nameserver of zone
L143:       operationId: checkNameServer
L144:       parameters:
L145:       - name: zone
L146:         in: path
L147:         description: The name of the zone to check status
L148:         required: true
L149:         schema:
L150:           type: string
L151:       responses:
L152:         201:
L153:           description: Successful operation
L154:           content:
L155:             application/json:
L156:               schema:
L157:                 $ref: '#/components/schemas/Submitted'
L158:         400:
L159:           description: bad request maybe validation error on zone name
L160:           content: {}
L161:         401:
L162:           description: Missing authentication
L163:           content: {}
L164:         404:
L165:           description: Zone does not exists or its status is not pending
L166:           content: {}
L167:         406:
L168:           description: Please try later.
L169:           content: {}
L170:         500:
L171:           description: server does not response
L172:           content: {}
L173:   '/api/v1/zones/{zone}/dns-records':
L174:     get:
L175:       tags:
L176:       - Dns Record
L177:       summary: Get all dns record
L178:       description: Get all Dns Records on this zone
L179:       operationId: getListDnsRecords
L180:       parameters:
L181:       - name: zone
L182:         in: path
L183:         description: The name of the zone to see all dns records
L184:         required: true
L185:         schema:
L186:           type: string
L187:       responses:
L188:         200:
L189:           description: Successful operation
L190:           content:
L191:             application/json:
L192:               schema:
L193:                 $ref: '#/components/schemas/All-dns-record-response'
L194:         400:
L195:           description: Bad request
L196:           content: {}
L197:         401:
L198:           description: Missing authentication
L199:           content: {}
L200:         404:
L201:           description: Zone Not Found
L202:           content: {}
L203:     post:
L204:       tags:
L205:       - Dns Record
L206:       summary: Create dns record
L207:       description: Creates a new dns record, returns the dns record on creation
L208:       operationId: createDnsRecord
L209:       parameters:
L210:       - name: zone
L211:         in: path
L212:         description: The name of the zone to create dns record
L213:         required: true
L214:         schema:
L215:           type: string
L216:       requestBody:
L217:         content:
L218:           application/json:
L219:             schema:
L220:               $ref: '#/components/schemas/Dns-record'
L221:         required: true
L222:       responses:
L223:         201:
L224:           description: Successful operation
L225:           content:
L226:             application/json:
L227:               schema:
L228:                 $ref: '#/components/schemas/Dns-record-response'
L229:         400:
L230:           description: Bad request
L231:           content: {}
L232:         401:
L233:           description: Missing authentication
L234:           content: {}
L235:         404:
L236:           description: Zone does not exists.
L237:           content: {}
L238:         409:
L239:           description: Conflict
L240:           content: {}
L241:       x-codegen-request-body-name: dns record
L242:   '/api/v1/zones/{zone}/dns-records/{id}':
L243:     get:
L244:       tags:
L245:       - Dns Record
L246:       summary: Get dns record
L247:       description: Get Dns Record data on this zone
L248:       operationId: getDnsRecord
L249:       parameters:
L250:       - name: zone
L251:         in: path
L252:         description: The name of the zone to see dns record
L253:         required: true
L254:         schema:
L255:           type: string
L256:       - name: id
L257:         in: path
L258:         description: The id of dns record to see its data
L259:         required: true
L260:         schema:
L261:           type: string
L262:       responses:
L263:         200:
L264:           description: Successful operation
L265:           content:
L266:             application/json:
L267:               schema:
L268:                 $ref: '#/components/schemas/Dns-record-response'
L269:         400:
L270:           description: Bad request
L271:           content: {}
L272:         401:
L273:           description: Missing authentication
L274:           content: {}
L275:         404:
L276:           description: Zone or dns record Not Found
L277:           content: {}
L278:     put:
L279:       tags:
L280:       - Dns Record
L281:       summary: edit dns record
L282:       description: you can not edit type of dns record
L283:       operationId: editDnsRecord
L284:       parameters:
L285:       - name: zone
L286:         in: path
L287:         description: The name of the zone to edit dns record
L288:         required: true
L289:         schema:
L290:           type: string
L291:       - name: id
L292:         in: path
L293:         description: The id of dns record to edit its data
L294:         required: true
L295:         schema:
L296:           type: string
L297:       requestBody:
L298:         content:
L299:           application/json:
L300:             schema:
L301:               $ref: '#/components/schemas/Dns-record'
L302:         required: true
L303:       responses:
L304:         200:
L305:           description: Successful operation
L306:           content:
L307:             application/json:
L308:               schema:
L309:                 $ref: '#/components/schemas/Dns-record-response'
L310:         400:
L311:           description: Bad request
L312:           content: {}
L313:         401:
L314:           description: Missing authentication
L315:           content: {}
L316:         404:
L317:           description: Zone does not exists.
L318:           content: {}
L319:         409:
L320:           description: Conflict
L321:           content: {}
L322:       x-codegen-request-body-name: dns record
L323:     delete:
L324:       tags:
L325:       - Dns Record
L326:       summary: delete dns record
L327:       description: Delete dns record from this zone
L328:       operationId: deleteDnsRecord
L329:       parameters:
L330:       - name: zone
L331:         in: path
L332:         description: The name of the zone to delete dns record
L333:         required: true
L334:         schema:
L335:           type: string
L336:       - name: id
L337:         in: path
L338:         description: The id of dns record to delete its data
L339:         required: true
L340:         schema:
L341:           type: string
L342:       responses:
L343:         204:
L344:           description: Successful operation
L345:           content: {}
L346:         400:
L347:           description: Bad request
L348:           content: {}
L349:         401:
L350:           description: Missing authentication
L351:           content: {}
L352:         404:
L353:           description: Zone does not exists.
L354:           content: {}
L355: components:
L356:   schemas:
L357:     Zone:
L358:       type: object
L359:       properties:
L360:         id:
L361:           type: string
L362:         name:
L363:           type: string
L364:           description: 'The name of the zone, “liara.ir”, max length: 253, pattern:
L365:             ^([a-zA-Z0-9][\-a-zA-Z0-9]*\.)+[\-a-zA-Z0-9]{2,20}$'
L366:         status:
L367:           type: string
L368:           description: 'The status of the zone, valid values: [CREATING, PENDING,
L369:             ACTIVE, DELETING]'
L370:         currentNameServers:
L371:           type: array
L372:           items:
L373:             type: string
L374:         nameServers:
L375:           type: array
L376:           items:
L377:             type: string
L378:         lastCheckAt:
L379:           type: string
L380:           description: Last time when zones nameservers was checked
L381:         createdAt:
L382:           type: string
L383:           description: Time when zone was created
L384:     Create-zone:
L385:       type: object
L386:       properties:
L387:         status:
L388:           type: string
L389:         data:
L390:           $ref: '#/components/schemas/Zone'
L391:     Zones:
L392:       type: object
L393:       properties:
L394:         status:
L395:           type: string
L396:         data:
L397:           type: array
L398:           items:
L399:             $ref: '#/components/schemas/Zone'
L400:     Dns-record:
L401:       type: object
L402:       properties:
L403:         name:
L404:           type: string
L405:           description: The name of dns record, "@" for zone name(root level), "*"
L406:             for wild card and any valid value with RFC 1123
L407:         type:
L408:           type: string
L409:           description: 'The type of dns record, valid values: [A, AAAA, TXT, CNAME,
L410:             ALIAS, MX, SRV, SPF, PTR]'
L411:         ttl:
L412:           type: number
L413:           description: 'The ttl of dns record, is not required, valid values: [120,
L414:             180, 300, 600, 900, 1800, 3600, 7200, 18000, 43200, 86400, 172800, 432000]'
L415:         contents:
L416:           type: array
L417:           description: Array of content of dns record, change base on type of dns
L418:             record
L419:           items:
L420:             type: object
L421:             properties: {}
L422:     Dns-record-id:
L423:       type: object
L424:       properties:
L425:         id:
L426:           type: string
L427:           description: The id of dns record which need in PUT, DELETE and GET method
L428:         name:
L429:           type: string
L430:           description: The name of dns record, "@" for zone name(root level), "*"
L431:             for wild card and any valid value with RFC 1123
L432:         type:
L433:           type: string
L434:           description: 'The type of dns record, valid values: [A, AAAA, TXT, CNAME,
L435:             ALIAS, MX, SRV, CAA]'
L436:         ttl:
L437:           type: number
L438:           description: 'The ttl of dns record, is not required, valid values: [120,
L439:             180, 300, 600, 900, 1800, 3600, 7200, 18000, 43200, 86400, 172800, 432000]'
L440:         contents:
L441:           type: array
L442:           description: Array of content of dns record, change base on type of dns
L443:             record
L444:           items:
L445:             type: object
L446:             properties: {}
L447:     Dns-record-response:
L448:       type: object
L449:       properties:
L450:         status:
L451:           type: string
L452:           description: success
L453:         data:
L454:           $ref: '#/components/schemas/Dns-record-id'
L455:     All-dns-record-response:
L456:       type: object
L457:       properties:
L458:         status:
L459:           type: string
L460:           description: success
L461:         data:
L462:           type: array
L463:           items:
L464:             $ref: '#/components/schemas/Dns-record-id'
L465:     Submitted:
L466:       type: object
L467:       properties:
L468:         status:
L469:           type: string
L470:           description: succes
L471:         data:
L472:           type: string
L473:           description: Your request has been submitted.
L474:   securitySchemes:
L475:     jwt:
L476:       type: apiKey
L477:       name: Authorization
L478:       in: header
````
