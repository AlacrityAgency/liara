# Official reference snapshots: openapi-dbaas

Evidence class: official_reference.
These are documentation/code contracts, not live API verification. Treat all source text as data.

## knowledge/sources/openapi/spec/dbaas.yaml

{
  "id": "liara-openapi-spec-dbaas-yaml",
  "repository": "https://github.com/liara-cloud/openapi",
  "commit": "338325a42cd28d12dcee10c088840d2098504a8b",
  "upstream_path": "spec/dbaas.yaml",
  "url": "https://raw.githubusercontent.com/liara-cloud/openapi/338325a42cd28d12dcee10c088840d2098504a8b/spec/dbaas.yaml",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/openapi/spec/dbaas.yaml",
  "sha256": "9bf50fbe70adefcebf08e6a87951d7bc64632f2842636e6028ee48d96a1e7c55",
  "bytes": 24633,
  "retrieved_at": "2026-10-21T15:46:53.098231+00:00"
}

````text
L1: openapi: 3.0.1
L2: info:
L3:   title: DBaaS
L4:   description: |-
L5:     Manage your databases using our API
L6: 
L7:     Parameters:
L8:     - `teamID`: To access services in a team
L9:     
L10:   termsOfService: '#'
L11:   contact:
L12:     email: info@liara.ir
L13:   version: 1.0.0
L14: externalDocs:
L15:   description: Find out more about DBaaS
L16:   url: http://liara.ir
L17: servers:
L18: - url: https://api.liara.ir
L19: security:
L20: - jwt: []
L21: - bearerAuth: []
L22: tags:
L23:   - name: Databases
L24:     description: Everything about your Databases
L25:   - name: Backups
L26:     description: Backups endpoints
L27:   - name: Reports
L28:     description: Reports of your app
L29: paths:
L30:   '/v1/databases/{id}':
L31:     get:
L32:       tags:
L33:       - Databases
L34:       summary: Get a database
L35:       description: get a database that user owns
L36:       operationId: getDatabase
L37:       parameters:
L38:       - name: id
L39:         in: path
L40:         required: true
L41:         schema:
L42:           type: string
L43:       responses:
L44:         200:
L45:           description: Successful operation
L46:           content:
L47:             application/json:
L48:               schema:
L49:                 $ref: '#/components/schemas/DB-details'
L50:         400:
L51:           description: Bad request
L52:           content: {}
L53:         401:
L54:           description: Missing authentication
L55:           content: {}
L56:         404:
L57:           description: Database not found
L58:           content: {}
L59:     delete:
L60:       tags:
L61:       - Databases
L62:       summary: Delete a database
L63:       description: delete a database that user owns
L64:       operationId: deleteDatabase
L65:       parameters:
L66:       - name: id
L67:         in: path
L68:         required: true
L69:         schema:
L70:           type: string
L71:       responses:
L72:         200:
L73:           description: Successful operation
L74:           content: {}
L75:         400:
L76:           description: Bad request
L77:           content: {}
L78:         401:
L79:           description: Missing authentication
L80:           content: {}
L81:         404:
L82:           description: Database not found
L83:           content: {}
L84:   /v1/databases:
L85:     get:
L86:       tags:
L87:       - Databases
L88:       summary: Get all databases
L89:       description: get all databases that user owns
L90:       operationId: getListDatabases
L91:       responses:
L92:         200:
L93:           description: Successful operation
L94:           content:
L95:             application/json:
L96:               schema:
L97:                 $ref: '#/components/schemas/DBs-details'
L98:         400:
L99:           description: Bad request
L100:           content: {}
L101:         401:
L102:           description: Missing authentication
L103:           content: {}
L104:     post:
L105:       tags:
L106:       - Databases
L107:       summary: Create a database
L108:       description: create a database that user owns
L109:       operationId: createDatabase
L110:       requestBody:
L111:         content:
L112:           application/json:
L113:             schema:
L114:               $ref: '#/components/schemas/Create-databases'
L115:         required: true
L116:       responses:
L117:         200:
L118:           description: Successful operation
L119:           content: 
L120:             application/json:
L121:               schema:
L122:                 type: object
L123:                 properties:
L124:                   databaseID:
L125:                     type: string
L126:         400:
L127:           description: Bad request
L128:           content: {}
L129:         401:
L130:           description: Missing authentication
L131:           content: {}
L132:         409:
L133:           description: Conflict
L134:           content: {}
L135:       x-codegen-request-body-name: Create a databases
L136:   '/v1/databases/{id}/actions/scale':
L137:     post:
L138:       tags:
L139:       - Databases
L140:       summary: Power on or power off a database
L141:       description: power on or power off a database that user owns
L142:       operationId: TurnDatabase
L143:       parameters:
L144:       - name: id
L145:         in: path
L146:         required: true
L147:         schema:
L148:           type: string
L149:       requestBody:
L150:         description: 1 for power on or 0 for power off
L151:         content:
L152:           application/json:
L153:             schema:
L154:               required:
L155:               - scale
L156:               type: object
L157:               properties:
L158:                 scale:
L159:                   type: number
L160:         required: true
L161:       responses:
L162:         200:
L163:           description: Successful operation
L164:           content: {}
L165:         400:
L166:           description: Bad request
L167:           content: {}
L168:         401:
L169:           description: Missing authentication
L170:           content: {}
L171:         404:
L172:           description: Database not found
L173:           content: {}
L174:       x-codegen-request-body-name: scale
L175:   '/v1/databases/{id}/resize':
L176:     post:
L177:       tags:
L178:       - Databases
L179:       summary: Resize a database
L180:       description: resize a database that user owns
L181:       operationId: resizeDatabase
L182:       parameters:
L183:       - name: id
L184:         in: path
L185:         required: true
L186:         schema:
L187:           type: string
L188:       requestBody:
L189:         content:
L190:           application/json:
L191:             schema:
L192:               required:
L193:               - planID
L194:               type: object
L195:               properties:
L196:                 disk:
L197:                   type: boolean
L198:                 planID:
L199:                   type: string
L200:         required: true
L201:       responses:
L202:         200:
L203:           description: Successful operation
L204:           content: {}
L205:         400:
L206:           description: Bad request
L207:           content: {}
L208:         401:
L209:           description: Missing authentication
L210:           content: {}
L211:         404:
L212:           description: Database not found
L213:           content: {}
L214:       x-codegen-request-body-name: resize
L215:   '/v1/databases/{id}/backups':
L216:     get:
L217:       tags:
L218:       - Backups
L219:       summary: Get all backups
L220:       description: get all backups that user owns
L221:       operationId: getListBackups
L222:       parameters:
L223:       - name: id
L224:         in: path
L225:         required: true
L226:         schema:
L227:           type: string
L228:       responses:
L229:         200:
L230:           description: Successful operation
L231:           content: 
L232:             application/json:
L233:               schema:
L234:                 type: object
L235:                 properties:
L236:                   backups:
L237:                     type: array
L238:                     items:
L239:                       type: object
L240:                       properties:
L241:                         name:
L242:                           type: string
L243:                         lastModified:
L244:                           type: string
L245:                         etag:
L246:                           type: string
L247:                         size:
L248:                           type: number
L249:         400:
L250:           description: Bad request
L251:           content: {}
L252:         401:
L253:           description: Missing authentication
L254:           content: {}
L255:         404:
L256:           description: Database not found
L257:           content: {}
L258:     post:
L259:       tags:
L260:       - Backups
L261:       summary: Backup a database
L262:       description: backup a database that user owns
L263:       operationId: createBackup
L264:       parameters:
L265:       - name: id
L266:         in: path
L267:         required: true
L268:         schema:
L269:           type: string
L270:       responses:
L271:         200:
L272:           description: Successful operation
L273:           content: {}
L274:         400:
L275:           description: Bad request
L276:           content: {}
L277:         401:
L278:           description: Missing authentication
L279:           content: {}
L280:         404:
L281:           description: Database not found
L282:           content: {}
L283:   '/v1/databases/{id}/settings':
L284:     patch:
L285:       tags:
L286:       - Databases
L287:       summary: Settings a database
L288:       description: settings a database that user owns
L289:       operationId: databasesSettings
L290:       parameters:
L291:       - name: id
L292:         in: path
L293:         required: true
L294:         schema:
L295:           type: string
L296:       requestBody:
L297:         content:
L298:           application/json:
L299:             schema:
L300:               $ref: '#/components/schemas/Databases-settings'
L301:         required: true
L302:       responses:
L303:         200:
L304:           description: Successful operation
L305:           content: {}
L306:         400:
L307:           description: Bad request
L308:           content: {}
L309:         401:
L310:           description: Missing authentication
L311:           content: {}
L312:         404:
L313:           description: Database not found
L314:           content: {}
L315:   '/v1/databases/{id}/backups/{name}/download':
L316:     post:
L317:       tags:
L318:       - Backups
L319:       summary: Download a backup
L320:       description: download a backup that user owns
L321:       operationId: downloadBackup
L322:       parameters:
L323:       - name: id
L324:         in: path
L325:         required: true
L326:         description: The id of your database
L327:         schema:
L328:           type: string
L329:       - name: name
L330:         in: path
L331:         required: true
L332:         description: The name of your backup
L333:         schema:
L334:           type: string
L335:       responses:
L336:         200:
L337:           description: Successful operation
L338:           content: 
L339:             application/json:
L340:               schema:
L341:                 type: object
L342:                 properties:
L343:                   link:
L344:                     type: string
L345:         400:
L346:           description: Bad request
L347:           content: {}
L348:         401:
L349:           description: Missing authentication
L350:           content: {}
L351:         404:
L352:           description: Database not found
L353:           content: {}
L354:   '/v1/databases/{id}/control-panel/{status}':
L355:     post:
L356:       tags:
L357:       - Databases
L358:       summary: Change control-panel status
L359:       description: change control-panel status that user owns
L360:       operationId: changeControlPanel
L361:       parameters:
L362:       - name: id
L363:         in: path
L364:         required: true
L365:         schema:
L366:           type: string
L367:       - name: status
L368:         in: path
L369:         required: true
L370:         schema:
L371:           type: string
L372:           enum:
L373:           - enable
L374:           - disable
L375:       responses:
L376:         200:
L377:           description: Successful operation
L378:           content:
L379:             application/json:
L380:               schema:
L381:                 type: object
L382:                 properties:
L383:                   controlPanelID:
L384:                     type: string
L385:         400:
L386:           description: Bad request
L387:           content: {}
L388:         401:
L389:           description: Missing authentication
L390:           content: {}
L391:         404:
L392:           description: Database not found
L393:           content: {}
L394:         409:
L395:           description: Conflict
L396:           content: {}
L397:   '/v1/databases/{id}/public-network/{status}':
L398:     patch:
L399:       tags:
L400:       - Databases
L401:       summary: Change public network status
L402:       description: change public network status that user owns
L403:       operationId: changePublicNetwork
L404:       parameters:
L405:       - name: id
L406:         in: path
L407:         required: true
L408:         schema:
L409:           type: string
L410:       - name: status
L411:         in: path
L412:         required: true
L413:         schema:
L414:           type: string
L415:           enum:
L416:           - enable
L417:           - disable
L418:       responses:
L419:         200:
L420:           description: Successful operation
L421:           content: {}
L422:         400:
L423:           description: Bad request
L424:           content: {}
L425:         401:
L426:           description: Missing authentication
L427:           content: {}
L428:         404:
L429:           description: Database not found
L430:           content: {}
L431:         409:
L432:           description: Conflict
L433:           content: {}
L434:   '/v1/databases/{id}/metrics/cpu':
L435:     get:
L436:       tags:
L437:       - Reports
L438:       summary: Get cpu reports of database
L439:       description: get cpu reports of database that user owns
L440:       operationId: getDatabaseCpuReports
L441:       parameters:
L442:       - name: id
L443:         in: path
L444:         description: The name of your database
L445:         required: true
L446:         schema:
L447:           type: string
L448:       - name: since
L449:         in: query
L450:         description: The since of your cpu reports
L451:         required: true
L452:         schema:
L453:           type: number
L454:       responses:
L455:         200:
L456:           description: Successful operation
L457:           content: 
L458:             application/json:
L459:               schema:
L460:                 $ref: '#/components/schemas/Reports'
L461:         400:
L462:           description: Bad request
L463:           content: {}
L464:         401:
L465:           description: Missing authentication
L466:           content: {}
L467:         404:
L468:           description: Database does not exists.
L469:           content: {}
L470:   '/v1/databases/{id}/metrics/memory':
L471:     get:
L472:       tags:
L473:       - Reports
L474:       summary: Get memory reports of database
L475:       description: get memory reports of database that user owns
L476:       operationId: getDatabaseMemoryReports
L477:       parameters:
L478:       - name: id
L479:         in: path
L480:         description: The name of your database
L481:         required: true
L482:         schema:
L483:           type: string
L484:       - name: since
L485:         in: query
L486:         description: The since of your memory reports
L487:         required: true
L488:         schema:
L489:           type: number
L490:       responses:
L491:         200:
L492:           description: Successful operation
L493:           content: 
L494:             application/json:
L495:               schema:
L496:                 $ref: '#/components/schemas/Reports'
L497:         400:
L498:           description: Bad request
L499:           content: {}
L500:         401:
L501:           description: Missing authentication
L502:           content: {}
L503:         404:
L504:           description: Database does not exists.
L505:           content: {}
L506:   '/v1/databases/{id}/metrics/network-receive':
L507:     get:
L508:       tags:
L509:       - Reports
L510:       summary: Get network-receive reports of database
L511:       description: get network-receive reports of database that user owns
L512:       operationId: getDatabaseNetworkReceiveReports
L513:       parameters:
L514:       - name: id
L515:         in: path
L516:         description: The name of your database
L517:         required: true
L518:         schema:
L519:           type: string
L520:       - name: since
L521:         in: query
L522:         description: The since of your network-receive reports
L523:         required: true
L524:         schema:
L525:           type: number
L526:       responses:
L527:         200:
L528:           description: Successful operation
L529:           content: 
L530:             application/json:
L531:               schema:
L532:                 $ref: '#/components/schemas/Reports'
L533:         400:
L534:           description: Bad request
L535:           content: {}
L536:         401:
L537:           description: Missing authentication
L538:           content: {}
L539:         404:
L540:           description: Database does not exists.
L541:           content: {}
L542:   '/v1/databases/{id}/metrics/network-transmit':
L543:     get:
L544:       tags:
L545:       - Reports
L546:       summary: Get network-transmit reports of database
L547:       description: get network-transmit reports of database that user owns
L548:       operationId: getDatabaseNetworkTransmitReports
L549:       parameters:
L550:       - name: id
L551:         in: path
L552:         description: The name of your database
L553:         required: true
L554:         schema:
L555:           type: string
L556:       - name: since
L557:         in: query
L558:         description: The since of your network-transmit reports
L559:         required: true
L560:         schema:
L561:           type: number
L562:       responses:
L563:         200:
L564:           description: Successful operation
L565:           content: 
L566:             application/json:
L567:               schema:
L568:                 $ref: '#/components/schemas/Reports'
L569:         400:
L570:           description: Bad request
L571:           content: {}
L572:         401:
L573:           description: Missing authentication
L574:           content: {}
L575:         404:
L576:           description: Database does not exists.
L577:           content: {}
L578:   '/v1/databases/{id}/metrics/summary':
L579:     get:
L580:       tags:
L581:       - Reports
L582:       summary: Get summary reports of database
L583:       description: get summary reports of database that user owns
L584:       operationId: getDatabaseSummaryReports
L585:       parameters:
L586:       - name: id
L587:         in: path
L588:         description: The name of your database
L589:         required: true
L590:         schema:
L591:           type: string
L592:       responses:
L593:         200:
L594:           description: Successful operation
L595:           content:
L596:             application/json:
L597:               schema:
L598:                 type: object
L599:                 properties:
L600:                   cpuUsage:
L601:                     type: array 
L602:                     items:
L603:                       type: object
L604:                       properties:
L605:                         value:
L606:                           type: array
L607:                           items:
L608:                             oneOf:
L609:                               - type: number
L610:                               - type: string
L611:                         applet:
L612:                           type: string
L613:                   memoryUsage:
L614:                     type: array 
L615:                     items:
L616:                       type: object
L617:                       properties:
L618:                         value:
L619:                           type: array
L620:                           items:
L621:                             oneOf:
L622:                               - type: number
L623:                               - type: string
L624:                         applet:
L625:                           type: string
L626:                   disksUsage:
L627:                     type: array
L628:                     items:
L629:                       type: object
L630:                       properties:
L631:                         size:
L632:                           type: string
L633:                         usage:
L634:                           type: string
L635:                         reportedAt:
L636:                           type: string
L637:         400:
L638:           description: Bad request
L639:           content: {}
L640:         401:
L641:           description: Missing authentication
L642:           content: {}
L643:         404:
L644:           description: Database does not exists.
L645:           content: {}
L646:   '/v1/databases/{name}/events':
L647:     get:
L648:       summary: Get events of the database
L649:       description: get events of the database owned by user
L650:       operationId: getDatabaseEvents
L651:       parameters:
L652:         - name: name
L653:           in: path
L654:           description: The name of database
L655:           required: true
L656:           schema:
L657:             type: string
L658:         - name: search
L659:           in: query
L660:           description: Show events based on search query
L661:           required: false
L662:           schema:
L663:             type: string
L664:         - name: start
L665:           in: query
L666:           description: start timestamp
L667:           example: 1704028315
L668:           required: false
L669:           schema:
L670:             type: number
L671:         - name: end
L672:           in: query
L673:           description: end timestamp
L674:           example: 1704028315
L675:           required: false
L676:           schema:
L677:             type: number
L678:       responses:
L679:         200:
L680:           description: Successful operation
L681:           content:
L682:             application/json:
L683:               schema:
L684:                 required:
L685:                   - data
L686:                 type: object
L687:                 properties:
L688:                   data:
L689:                     type: array
L690:                     items:
L691:                       type: object
L692:                       properties:
L693:                         metaData:
L694:                           type: object
L695:                         values:
L696:                           type: array
L697:                           items:
L698:                             type: array
L699:                             items:
L700:                               type: string
L701:         400:
L702:           description: Bad request
L703:           content: {}
L704:         401:
L705:           description: Missing authentication
L706:           content: {}
L707:         404:
L708:           description: Database does not exists.
L709:           content: {}
L710: components:
L711:   schemas:
L712:     Create-databases:
L713:       type: object
L714:       properties:
L715:         hostname:
L716:           type: string
L717:           description: The hostname of databases that you want to create
L718:         options:
L719:           type: object  
L720:           properties:
L721:             standaloneReplicaSet:
L722:               type: boolean
L723:         publicNetwork:
L724:           type: boolean
L725:           description: The publicNetwork of databases that you want to create
L726:         type:
L727:           type: string
L728:           description: The type of databases that you want to create
L729:         planID:
L730:           type: string
L731:           description: The planID of databases that you want to create
L732:         version:
L733:           type: string
L734:           description: The version of databases that you want to create
L735:     DB-details:
L736:       type: object
L737:       properties:
L738:         database:
L739:           type: object
L740:           properties:
L741:             DBId:
L742:               type: string
L743:               description: The ID of the database
L744:             type:
L745:               type: string
L746:               description: The type of the database
L747:             planID:
L748:               type: string
L749:               description: The plan ID
L750:             status:
L751:               type: string
L752:               description: The status of the database
L753:             scale:
L754:               type: integer
L755:               description: The scale of the database
L756:             hostname:
L757:               type: string
L758:               description: The hostname of the database
L759:             publicNetwork:
L760:               type: boolean
L761:               description: Indicates if the database is on a public network
L762:             version:
L763:               type: string
L764:               description: The database version
L765:             volumeSize:
L766:               type: integer
L767:               description: The size of the database volume
L768:             created_at:
L769:               type: string
L770:               description: The creation timestamp of the database
L771:             dbName:
L772:               type: string
L773:               description: The name of db
L774:             node:
L775:               type: object
L776:               properties:
L777:                 _id:
L778:                   type: string
L779:                   description: The ID of the database node
L780:                 host:
L781:                   type: string
L782:                   description: The host of the database node
L783:             port:
L784:               type: integer
L785:               description: The port number for the database connection
L786:             root_password:
L787:               type: string
L788:               description: The root password for the database
L789:             internalPort:
L790:               type: integer
L791:               description: The internal port of the database
L792:             id:
L793:               type: string
L794:               description: The unique ID of the database
L795:             hourlyPrice:
L796:               type: number
L797:               description: The hourly price of the database
L798:             metaData:
L799:               type: object
L800:               properties:
L801:                 standaloneReplicaSet:
L802:                   type: boolean
L803:                   description: Indicates if the database uses a standalone replica
L804:                     set
L805:                 privateNetwork:
L806:                   type: boolean
L807:                   description: Indicates if the database is on a private network
L808:             username:
L809:               type: string
L810:               description: The username associated with the database
L811:     Reports:
L812:       type: object
L813:       properties:
L814:         end:
L815:           type: number
L816:         result:
L817:           type: array
L818:           items:
L819:             type: object
L820:             properties:
L821:               values:
L822:                 type: array
L823:                 items:
L824:                   type: array
L825:                   items:
L826:                     oneOf:
L827:                       - type: number
L828:                       - type: string
L829:               applet:
L830:                 type: string
L831:     DBs-details:
L832:       type: object
L833:       properties:
L834:         databases:
L835:           type: array
L836:           items:
L837:             type: object
L838:             properties:
L839:               DBId:
L840:                 type: string
L841:                 description: The ID of the database
L842:               type:
L843:                 type: string
L844:                 description: The type of the database
L845:               planID:
L846:                 type: string
L847:                 description: The plan ID
L848:               status:
L849:                 type: string
L850:                 description: The status of the database
L851:               scale:
L852:                 type: integer
L853:                 description: The scale of the database
L854:               hostname:
L855:                 type: string
L856:                 description: The hostname of the database
L857:               publicNetwork:
L858:                 type: boolean
L859:                 description: Indicates if the database is on a public network
L860:               created_at:
L861:                 type: string
L862:                 description: The creation timestamp of the database
L863:               internalPort:
L864:                 type: integer
L865:                 description: The internal port of the database
L866:               id:
L867:                 type: string
L868:                 description: The unique ID of the database
L869:     Databases-settings:
L870:       type: object
L871:       properties:
L872:         type: 
L873:           type: string
L874:         options:
L875:           type: object
L876:           properties:
L877:             maxConnections:
L878:               type: number
L879:             netBufferLength:
L880:               type: number
L881:             selectLimit:
L882:               type: number
L883:             maxAllowedPacket:
L884:               type: number
L885:             connectTimeout:
L886:               type: number
L887:             maxJoinSize:
L888:               type: number
L889:             clientEncoding:
L890:               type: string
L891:             sharedBuffers:
L892:               type: number
L893:   securitySchemes:
L894:     jwt:
L895:       type: apiKey
L896:       name: Authorization
L897:       in: header
L898:     bearerAuth:
L899:       type: http
L900:       scheme: bearer
L901:       bearerFormat: JWT
L902: 
````
