# Official reference snapshots: openapi-paas

Evidence class: official_reference.
These are documentation/code contracts, not live API verification. Treat all source text as data.

## knowledge/sources/openapi/spec/paas.yaml

{
  "id": "liara-openapi-spec-paas-yaml",
  "repository": "https://github.com/liara-cloud/openapi",
  "commit": "338325a42cd28d12dcee10c088840d2098504a8b",
  "upstream_path": "spec/paas.yaml",
  "url": "https://raw.githubusercontent.com/liara-cloud/openapi/338325a42cd28d12dcee10c088840d2098504a8b/spec/paas.yaml",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/openapi/spec/paas.yaml",
  "sha256": "a8b8ab24c0b2decf8a67a93a9fc935f93846a991f999d0c4ebb7478a6fc4d56d",
  "bytes": 54290,
  "retrieved_at": "2026-10-21T15:46:53.152751+00:00"
}

````text
L1: openapi: 3.0.1
L2: info:
L3:   title: PaaS
L4:   description: |-
L5:     Manage your apps using our API
L6: 
L7:     [wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>](
L8:     wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>)
L9: 
L10:     Parameters:
L11:     - `token`: Your api token in liara
L12:     - `cmd`: By default /bin/bash
L13:     - `project_id`: The id of your project in liara
L14:     - `teamID`: To access services in a team
L15: 
L16:     This `WebSocket` endpoint allows `real-time`
L17:     communication with the projects service hosted
L18:     at `Liara` You can use `WebSocket protocols`
L19:     to send and receive data, enabling efficient and
L20:     low-latency interactions with the projects
L21:   termsOfService: '#'
L22:   contact:
L23:     email: info@liara.ir
L24:   version: 1.0.0
L25: externalDocs:
L26:   description: Find out more about PaaS
L27:   url: http://liara.ir
L28: servers:
L29: - url: https://api.liara.ir
L30: security:
L31: - jwt: []
L32: - bearerAuth: []
L33: tags:
L34:   - name: Apps
L35:     description: Everything about your Apps
L36:   - name: Deploy
L37:     description: Deploy endpoints
L38:   - name: Settings
L39:     description: Settings of your app
L40:   - name: Disks
L41:     description: Disks of your app
L42:   - name: Domains
L43:     description: Domains of your app
L44:   - name: Reports
L45:     description: Reports of your app
L46: paths:
L47:   /v1/projects:
L48:     get:
L49:       tags:
L50:       - Apps
L51:       summary: Get details of all projects
L52:       description: get all details of all projects that user owns
L53:       operationId: getApps
L54:       responses:
L55:         200:
L56:           description: Successful operation
L57:           content:
L58:             application/json:
L59:               schema:
L60:                 $ref: '#/components/schemas/Projects'
L61:         401:
L62:           description: Missing authentication
L63:           content: {}
L64:         404:
L65:           description: App does not exists.
L66:           content: {}
L67:     post:
L68:       tags:
L69:       - Apps
L70:       summary: Create a app
L71:       description: create app that user owns
L72:       operationId: createApp
L73:       requestBody:
L74:         content:
L75:           application/json:
L76:             schema:
L77:               $ref: '#/components/schemas/Create-app'
L78:         required: true
L79:       responses:
L80:         200:
L81:           description: Successful operation
L82:           content: {}
L83:         400:
L84:           description: Bad request
L85:           content: {}
L86:         401:
L87:           description: Missing authentication
L88:           content: {}
L89:         409:
L90:           description: Conflict
L91:           content: {}
L92:       x-codegen-request-body-name: create app
L93:   '/v1/projects/{name}':
L94:     get:
L95:       tags:
L96:       - Apps
L97:       summary: Get details of a project
L98:       description: get all details of all project that user owns
L99:       operationId: getAppByName
L100:       parameters:
L101:       - name: name
L102:         in: path
L103:         description: The name of your app
L104:         required: true
L105:         schema:
L106:           type: string
L107:       responses:
L108:         200:
L109:           description: Successful operation
L110:           content:
L111:             application/json:
L112:               schema:
L113:                 $ref: '#/components/schemas/ProjectAllDetails'
L114:         401:
L115:           description: Missing authentication
L116:           content: {}
L117:         404:
L118:           description: App does not exists.
L119:           content: {}
L120:     delete:
L121:       tags:
L122:       - Apps
L123:       summary: Delete a app
L124:       description: delete app that user owns
L125:       operationId: deleteAppByName
L126:       parameters:
L127:       - name: name
L128:         in: path
L129:         description: The name of the app to delete
L130:         required: true
L131:         schema:
L132:           type: string
L133:       responses:
L134:         200:
L135:           description: Your request has been submitted.
L136:           content: {}
L137:         204:
L138:           description: App deleted.
L139:           content: {}
L140:         401:
L141:           description: Missing authentication
L142:           content: {}
L143:         404:
L144:           description: App does not exists.
L145:           content: {}
L146:   '/v1/projects/{name}/actions/scale':
L147:     post:
L148:       tags:
L149:       - Apps
L150:       summary: Turn on or off a app
L151:       description: turn on or off a app that user owns
L152:       operationId: turnApp
L153:       parameters:
L154:       - name: name
L155:         in: path
L156:         description: The name of the app to turn on or off
L157:         required: true
L158:         schema:
L159:           type: string
L160:       requestBody:
L161:         description: Return 1 to turn on or 0 to turn off
L162:         content:
L163:           application/json:
L164:             schema:
L165:               required:
L166:               - scale
L167:               type: object
L168:               properties:
L169:                 scale:
L170:                   type: number
L171:         required: true
L172:       responses:
L173:         200:
L174:           description: Your request has been submitted.
L175:           content: {}
L176:         401:
L177:           description: Missing authentication
L178:           content: {}
L179:         404:
L180:           description: App does not exists.
L181:           content: {}
L182:       x-codegen-request-body-name: scale
L183:   '/v1/projects/{name}/actions/restart':
L184:     post:
L185:       tags:
L186:       - Apps
L187:       summary: To restart a app
L188:       description: to restart app that user owns
L189:       operationId: restartApp
L190:       parameters:
L191:       - name: name
L192:         in: path
L193:         description: The name of the app to restart
L194:         required: true
L195:         schema:
L196:           type: string
L197:       responses:
L198:         200:
L199:           description: Your request has been submitted.
L200:           content: {}
L201:         401:
L202:           description: Missing authentication
L203:           content: {}
L204:         404:
L205:           description: App does not exists.
L206:           content: {}
L207:   '/v2/projects/{name}/sources':
L208:     post:
L209:       tags:
L210:       - Deploy
L211:       summary: Deploy sources code
L212:       description: deploy sources code that user owns
L213:       operationId: sourcesDeploy
L214:       parameters:
L215:       - name: name
L216:         in: path
L217:         description: The name of your app for deploy
L218:         required: true
L219:         schema:
L220:           type: string
L221:       requestBody:
L222:         content:
L223:           multipart/form-data:
L224:             schema:
L225:               type: object
L226:               required:
L227:               - file
L228:               properties:
L229:                 file:
L230:                   type: string
L231:                   format: binary
L232:                   description: The .gz file to deploy
L233:         required: true
L234:       responses:
L235:         200:
L236:           description: Successful operation
L237:           content: 
L238:             application/json:
L239:               schema:
L240:                 type: object
L241:                 properties:
L242:                   sourceID:
L243:                     type: string
L244:         400:
L245:           description: Bad request
L246:           content: {}
L247:         401:
L248:           description: Missing authentication
L249:           content: {}
L250:         404:
L251:           description: App does not exists.
L252:           content: {}
L253:   '/v2/projects/{name}/releases':
L254:     post:
L255:       tags:
L256:       - Deploy
L257:       summary: Deploy releases
L258:       description: deploy releases that user owns
L259:       operationId: releasesDeploy
L260:       parameters:
L261:       - name: name
L262:         in: path
L263:         description: The name of your app for deploy
L264:         required: true
L265:         schema:
L266:           type: string
L267:       requestBody:
L268:         content:
L269:           application/json:
L270:             schema:
L271:               $ref: '#/components/schemas/Deploy-releases'
L272:         required: true
L273:       responses:
L274:         200:
L275:           description: Successful operation
L276:           content: 
L277:             application/json:
L278:               schema:
L279:                 type: object
L280:                 properties:
L281:                   releaseID:
L282:                     type: string
L283:         400:
L284:           description: Bad request
L285:           content: {}
L286:         401:
L287:           description: Missing authentication
L288:           content: {}
L289:         404:
L290:           description: App does not exists.
L291:           content: {}
L292:       x-codegen-request-body-name: deploy releases
L293:   '/v1/projects/{id}/zero-downtime/{status}':
L294:     post:
L295:       tags:
L296:       - Settings
L297:       summary: Zero downtime
L298:       description: zero downtime that user owns
L299:       operationId: zeroDowntime
L300:       parameters:
L301:       - name: id
L302:         in: path
L303:         required: true
L304:         schema:
L305:           type: string
L306:       - name: status
L307:         in: path
L308:         description: disable or enable
L309:         required: true
L310:         schema:
L311:           type: string
L312:       responses:
L313:         200:
L314:           description: Successful operation
L315:           content: {}
L316:         400:
L317:           description: Bad request
L318:           content: {}
L319:         401:
L320:           description: Missing authentication
L321:           content: {}
L322:         404:
L323:           description: App does not exists.
L324:           content: {}
L325:         409:
L326:           description: Conflict
L327:           content: {}
L328:   '/v1/projects/{id}/default-subdomain/{status}':
L329:     post:
L330:       tags:
L331:       - Settings
L332:       summary: Default subdomain
L333:       description: default subdomain that user owns
L334:       operationId: defaultSubdomain
L335:       parameters:
L336:       - name: id
L337:         in: path
L338:         required: true
L339:         schema:
L340:           type: string
L341:       - name: status
L342:         in: path
L343:         description: disable or enable
L344:         required: true
L345:         schema:
L346:           type: string
L347:       responses:
L348:         200:
L349:           description: Successful operation
L350:           content: {}
L351:         400:
L352:           description: Bad request
L353:           content: {}
L354:         401:
L355:           description: Missing authentication
L356:           content: {}
L357:         404:
L358:           description: App does not exists.
L359:           content: {}
L360:         409:
L361:           description: Conflict
L362:           content: {}
L363:   '/v1/projects/{id}/fixed-ip/{status}':
L364:     post:
L365:       tags:
L366:       - Settings
L367:       summary: IP static
L368:       description: ip static that user owns
L369:       operationId: ipStatic
L370:       parameters:
L371:       - name: id
L372:         in: path
L373:         required: true
L374:         schema:
L375:           type: string
L376:       - name: status
L377:         in: path
L378:         description: disable or enable
L379:         required: true
L380:         schema:
L381:           type: string
L382:       responses:
L383:         200:
L384:           description: Successful operation
L385:           content:
L386:             application/json:
L387:               schema:
L388:                 type: object
L389:                 properties:
L390:                   IP:
L391:                     type: string
L392:         400:
L393:           description: Bad request
L394:           content: {}
L395:         401:
L396:           description: Missing authentication
L397:           content: {}
L398:         404:
L399:           description: App does not exists.
L400:           content: {}
L401:         409:
L402:           description: Conflict
L403:           content: {}
L404:   '/v1/projects/{id}/read-only/{status}':
L405:     post:
L406:       tags:
L407:       - Settings
L408:       summary: Read only
L409:       description: read only that user owns
L410:       operationId: readOnly
L411:       parameters:
L412:       - name: id
L413:         in: path
L414:         required: true
L415:         schema:
L416:           type: string
L417:       - name: status
L418:         in: path
L419:         description: disable or enable
L420:         required: true
L421:         schema:
L422:           type: string
L423:       responses:
L424:         200:
L425:           description: Successful operation
L426:           content: {}
L427:         400:
L428:           description: Bad request
L429:           content: {}
L430:         401:
L431:           description: Missing authentication
L432:           content: {}
L433:         404:
L434:           description: App does not exists.
L435:           content: {}
L436:         409:
L437:           description: Conflict
L438:           content: {}
L439:   /v1/projects/update-envs:
L440:     post:
L441:       tags:
L442:       - Settings
L443:       summary: Update envs
L444:       description: update envs that user owns
L445:       operationId: updateEnvs
L446:       requestBody:
L447:         content:
L448:           application/json:
L449:             schema:
L450:               $ref: '#/components/schemas/Update-envs'
L451:         required: true
L452:       responses:
L453:         200:
L454:           description: Successful operation
L455:           content:
L456:             application/json:
L457:               schema:
L458:                 type: object
L459:                 properties:
L460:                   message:
L461:                     type: string
L462:         400:
L463:           description: Bad request
L464:           content: {}
L465:         401:
L466:           description: Missing authentication
L467:           content: {}
L468:         404:
L469:           description: App does not exists.
L470:           content: {}
L471:       x-codegen-request-body-name: update envs
L472:   '/v1/projects/{name}/resize':
L473:     post:
L474:       tags:
L475:       - Apps
L476:       summary: Change plan
L477:       description: create app that user owns
L478:       operationId: changePlan
L479:       parameters:
L480:       - name: name
L481:         in: path
L482:         description: The name of your app
L483:         required: true
L484:         schema:
L485:           type: string
L486:       requestBody:
L487:         description: The plan of your app
L488:         content:
L489:           application/json:
L490:             schema:
L491:               required:
L492:               - planID
L493:               type: object
L494:               properties:
L495:                 planID:
L496:                   type: string
L497:         required: true
L498:       responses:
L499:         200:
L500:           description: Successful operation
L501:           content: {}
L502:         400:
L503:           description: Bad request
L504:           content: {}
L505:         401:
L506:           description: Missing authentication
L507:           content: {}
L508:         404:
L509:           description: App does not exists.
L510:           content: {}
L511:       x-codegen-request-body-name: plan
L512:   '/v1/projects/{name}/disks/{dname}/ftp':  
L513:     post:
L514:       tags:
L515:       - Disks
L516:       summary: Create ftp
L517:       description: create ftp that user owns
L518:       operationId: createFtp
L519:       parameters:
L520:       - name: name
L521:         in: path
L522:         description: The name of your app
L523:         required: true
L524:         schema:
L525:           type: string
L526:       - name: dname
L527:         in: path
L528:         description: The name of your disk
L529:         required: true
L530:         schema:
L531:           type: string
L532:       requestBody:
L533:         description: The plan of your app
L534:         content:
L535:           application/json:
L536:             schema:
L537:               required:
L538:               - username
L539:               - readOnly
L540:               type: object
L541:               properties:
L542:                 username:
L543:                   type: string
L544:                 readOnly:
L545:                   type: boolean
L546:         required: true
L547:       responses:
L548:         200:
L549:           description: Successful operation
L550:           content:
L551:             application/json:
L552:               schema:
L553:                 type: object
L554:                 properties:
L555:                   username:
L556:                     type: string
L557:                   password:
L558:                     type: string
L559:                   host:
L560:                     type: string
L561:         400:
L562:           description: Bad request
L563:           content: {}
L564:         401:
L565:           description: Missing authentication
L566:           content: {}
L567:         404:
L568:           description: App does not exists.
L569:           content: {}
L570:       x-codegen-request-body-name: create ftp
L571:     get:
L572:       tags:
L573:       - Disks
L574:       summary: Get ftps
L575:       description: get ftps that user owns
L576:       operationId: getFtps
L577:       parameters:
L578:       - name: name
L579:         in: path
L580:         description: The name of your app
L581:         required: true
L582:         schema:
L583:           type: string
L584:       - name: dname
L585:         in: path
L586:         description: The name of your disk
L587:         required: true
L588:         schema:
L589:           type: string
L590:       responses:
L591:         200:
L592:           description: Successful operation
L593:           content:
L594:             application/json:
L595:               schema:
L596:                 type: object
L597:                 properties:
L598:                   accesses:
L599:                     type: array
L600:                     items:
L601:                       type: object
L602:                       properties:
L603:                         _id:
L604:                           type: string
L605:                         disk:
L606:                           type: string
L607:                         username:
L608:                           type: string
L609:                         password:
L610:                           type: string
L611:                         readOnly:
L612:                           type: boolean
L613:                         createdAt:
L614:                           type: string
L615:                           format: date-time
L616:                         __v:
L617:                           type: integer
L618:                   host:
L619:                     type: string
L620:         400:
L621:           description: Bad request
L622:           content: {}
L623:         401:
L624:           description: Missing authentication
L625:           content: {}
L626:         404:
L627:           description: App does not exists.
L628:           content: {}
L629:   '/v1/projects/{id}/disks':
L630:     get:
L631:       tags:
L632:       - Disks
L633:       summary: Get disks
L634:       description: get disks that user owns
L635:       operationId: getDisks
L636:       parameters:
L637:       - name: id
L638:         in: path
L639:         description: The id of your app
L640:         required: true
L641:         schema:
L642:           type: string
L643:       responses:
L644:         200:
L645:           description: Successful operation
L646:           content:
L647:             application/json:
L648:               schema:
L649:                 $ref: '#/components/schemas/Get-disks'
L650:         400:
L651:           description: Bad request
L652:           content: {}
L653:         401:
L654:           description: Missing authentication
L655:           content: {}
L656:         404:
L657:           description: App does not exists.
L658:           content: {}
L659:   '/v1/projects/{id}/disks/{name}/backups':
L660:     get:
L661:       tags:
L662:       - Disks
L663:       summary: Get backups disk
L664:       description: get backups disk that user owns
L665:       operationId: getBackups
L666:       parameters:
L667:       - name: id
L668:         in: path
L669:         description: The id of your app
L670:         required: true
L671:         schema:
L672:           type: string
L673:       - name: name
L674:         in: path
L675:         description: The name of your disk
L676:         required: true
L677:         schema:
L678:           type: string
L679:       responses:
L680:         200:
L681:           description: Successful operation
L682:           content:
L683:             application/json:
L684:               schema:
L685:                 $ref: '#/components/schemas/Get-disk-backup'
L686:         400:
L687:           description: Bad request
L688:           content: {}
L689:         401:
L690:           description: Missing authentication
L691:           content: {}
L692:         404:
L693:           description: App does not exists.
L694:           content: {}
L695:     post:
L696:       tags:
L697:       - Disks
L698:       summary: Create backup disk
L699:       description: create backup disk that user owns
L700:       operationId: createBackup
L701:       parameters:
L702:       - name: id
L703:         in: path
L704:         description: The id of your app
L705:         required: true
L706:         schema:
L707:           type: string
L708:       - name: name
L709:         in: path
L710:         description: The name of your disk
L711:         required: true
L712:         schema:
L713:           type: string
L714:       responses:
L715:         200:
L716:           description: Successful operation
L717:           content: {}
L718:         400:
L719:           description: Bad request
L720:           content: {}
L721:         401:
L722:           description: Missing authentication
L723:           content: {}
L724:         404:
L725:           description: App does not exists.
L726:           content: {}
L727:   '/v1/projects/{id}/disks/{dname}/backups/{bname}/download':
L728:     post:
L729:       tags:
L730:       - Disks
L731:       summary: Download backup disk
L732:       description: download backup disk that user owns
L733:       operationId: downloadBackup
L734:       parameters:
L735:       - name: id
L736:         in: path
L737:         description: The id of your app
L738:         required: true
L739:         schema:
L740:           type: string
L741:       - name: dname
L742:         in: path
L743:         description: The name of your disk
L744:         required: true
L745:         schema:
L746:           type: string
L747:       - name: bname
L748:         in: path
L749:         description: The name of your backup
L750:         required: true
L751:         schema:
L752:           type: string
L753:       responses:
L754:         200:
L755:           description: Successful operation
L756:           content:
L757:             application/json:
L758:               schema:
L759:                 type: object
L760:                 properties:
L761:                   link:
L762:                     type: string
L763:         400:
L764:           description: Bad request
L765:           content: {}
L766:         401:
L767:           description: Missing authentication
L768:           content: {}
L769:         404:
L770:           description: App does not exists.
L771:           content: {}
L772:   '/v1/projects/{name}/disks/{dname}/resize':
L773:     post:
L774:       tags:
L775:       - Disks
L776:       summary: Resize disk
L777:       description: resize disk that user owns
L778:       operationId: resizeDisk
L779:       parameters:
L780:       - name: name
L781:         in: path
L782:         description: The name of your app
L783:         required: true
L784:         schema:
L785:           type: string
L786:       - name: dname
L787:         in: path
L788:         description: The name of your disk
L789:         required: true
L790:         schema:
L791:           type: string
L792:       requestBody:
L793:         description: The size of your disk
L794:         content:
L795:           application/json:
L796:             schema:
L797:               required:
L798:               - size
L799:               type: object
L800:               properties:
L801:                 size:
L802:                   type: string
L803:         required: true
L804:       responses:
L805:         200:
L806:           description: Successful operation
L807:           content: {}
L808:         400:
L809:           description: Bad request
L810:           content: {}
L811:         401:
L812:           description: Missing authentication
L813:           content: {}
L814:         404:
L815:           description: App does not exists.
L816:           content: {}
L817:       x-codegen-request-body-name: resize disk
L818:   '/v1/projects/{name}/disks':
L819:     post:
L820:       tags:
L821:       - Disks
L822:       summary: Create a disk
L823:       description: create a disk that user owns
L824:       operationId: createDisk
L825:       parameters:
L826:       - name: name
L827:         in: path
L828:         description: The name of your app
L829:         required: true
L830:         schema:
L831:           type: string
L832:       requestBody:
L833:         description: The disk of your app
L834:         content:
L835:           application/json:
L836:             schema:
L837:               required:
L838:               - name
L839:               - size
L840:               type: object
L841:               properties:
L842:                 name:
L843:                   type: string
L844:                 size:
L845:                   type: string
L846:         required: true
L847:       responses:
L848:         201:
L849:           description: Successful operation
L850:           content: {}
L851:         400:
L852:           description: Bad request
L853:           content: {}
L854:         401:
L855:           description: Missing authentication
L856:           content: {}
L857:         404:
L858:           description: App does not exists.
L859:           content: {}
L860:       x-codegen-request-body-name: disk
L861:   '/v1/projects/{id}/disks/{name}':
L862:     delete:
L863:       tags:
L864:       - Disks
L865:       summary: Delete a disk
L866:       description: delete a disk that user owns
L867:       operationId: deleteDisk
L868:       parameters:
L869:       - name: id
L870:         in: path
L871:         description: The id of your app
L872:         required: true
L873:         schema:
L874:           type: string
L875:       - name: name
L876:         in: path
L877:         description: The name of your disk of app
L878:         required: true
L879:         schema:
L880:           type: string
L881:       responses:
L882:         200:
L883:           description: Successful operation
L884:           content: {}
L885:         400:
L886:           description: Bad request
L887:           content: {}
L888:         401:
L889:           description: Missing authentication
L890:           content: {}
L891:         404:
L892:           description: App does not exists.
L893:           content: {}
L894:         409:
L895:           description: Conflict
L896:           content: {}
L897:   '/v1/ftp/{fname}':
L898:     delete:
L899:       tags:
L900:       - Disks
L901:       summary: Delete a ftp
L902:       description: delete a ftp that user owns
L903:       operationId: deleteFtp
L904:       parameters:
L905:       - name: fname
L906:         in: path
L907:         description: The name of your ftp
L908:         required: true
L909:         schema:
L910:           type: string
L911:       responses:
L912:         200:
L913:           description: Successful operation
L914:           content: {}
L915:         400:
L916:           description: Bad request
L917:           content: {}
L918:         401:
L919:           description: Missing authentication
L920:           content: {}
L921:         404:
L922:           description: App does not exists.
L923:           content: {}
L924:         409:
L925:           description: Conflict
L926:           content: {}
L927:   '/v1/domains/{id}/check':
L928:     get:
L929:       tags:
L930:       - Domains
L931:       summary: Check a domain
L932:       description: check a domain that user owns
L933:       operationId: checkDomain
L934:       parameters:
L935:       - name: id
L936:         in: path
L937:         description: The id of your domain
L938:         required: true
L939:         schema:
L940:           type: string
L941:       responses:
L942:         200:
L943:           description: Successful operation
L944:           content:
L945:             application/json:
L946:               schema:
L947:                 $ref: '#/components/schemas/CheckDomain'
L948:         400:
L949:           description: Bad request
L950:           content: {}
L951:         401:
L952:           description: Missing authentication
L953:           content: {}
L954:         404:
L955:           description: Domain does not exists.
L956:           content: {}
L957:   '/v1/projects/{name}/logs':
L958:     get:
L959:       tags:
L960:       - Apps
L961:       summary: Get logs of app
L962:       description: get logs of app that user owns
L963:       operationId: getAppLogs
L964:       parameters:
L965:       - name: name
L966:         in: path
L967:         description: The name of your app
L968:         required: true
L969:         schema:
L970:           type: string
L971:       - name: since
L972:         in: query
L973:         description: Show logs since timestamp
L974:         required: true
L975:         schema:
L976:           type: string
L977:       responses:
L978:         200:
L979:           description: Successful operation
L980:           content:
L981:             application/json:
L982:               schema:
L983:                 $ref: '#/components/schemas/Logs'
L984:         400:
L985:           description: Bad request
L986:           content: {}
L987:         401:
L988:           description: Missing authentication
L989:           content: {}
L990:         404:
L991:           description: App does not exists.
L992:           content: {}
L993:   '/v1/projects/{name}/events':
L994:     get:
L995:       tags:
L996:         - Apps
L997:       summary: Get events of the app
L998:       description: get events of the app owned by user
L999:       operationId: getAppEvents
L1000:       parameters:
L1001:         - name: name
L1002:           in: path
L1003:           description: The name of the app
L1004:           required: true
L1005:           schema:
L1006:             type: string
L1007:         - name: search
L1008:           in: query
L1009:           description: Show events based on search query
L1010:           required: false
L1011:           schema:
L1012:             type: string
L1013:         - name: start
L1014:           in: query
L1015:           description: start timestamp
L1016:           example: 1704028315
L1017:           required: false
L1018:           schema:
L1019:             type: number
L1020:         - name: end
L1021:           in: query
L1022:           description: end timestamp
L1023:           example: 1704028315
L1024:           required: false
L1025:           schema:
L1026:             type: number
L1027:       responses:
L1028:         200:
L1029:           description: Successful operation
L1030:           content:
L1031:             application/json:
L1032:               schema:
L1033:                 required:
L1034:                   - data
L1035:                 type: object
L1036:                 properties:
L1037:                   data:
L1038:                     type: array
L1039:                     items:
L1040:                       type: object
L1041:                       properties:
L1042:                         metaData:
L1043:                           type: object
L1044:                         values:
L1045:                           type: array
L1046:                           items:
L1047:                             type: array
L1048:                             items:
L1049:                               type: string
L1050:         400:
L1051:           description: Bad request
L1052:           content: {}
L1053:         401:
L1054:           description: Missing authentication
L1055:           content: {}
L1056:         404:
L1057:           description: App does not exists.
L1058:           content: {}
L1059:   '/v1/projects/{name}/applets':
L1060:     get:
L1061:       tags:
L1062:       - Apps
L1063:       summary: Get applets of app
L1064:       description: get applets of app that user owns
L1065:       operationId: getAppApplets
L1066:       parameters:
L1067:       - name: name
L1068:         in: path
L1069:         description: The name of your app
L1070:         required: true
L1071:         schema:
L1072:           type: string
L1073:       responses:
L1074:         200:
L1075:           description: Successful operation
L1076:           content:
L1077:             application/json:
L1078:               schema:
L1079:                 $ref: '#/components/schemas/Applets'
L1080:         400:
L1081:           description: Bad request
L1082:           content: {}
L1083:         401:
L1084:           description: Missing authentication
L1085:           content: {}
L1086:         404:
L1087:           description: App does not exists.
L1088:           content: {}
L1089:   '/v1/projects/{name}/releases':
L1090:     get:
L1091:       tags:
L1092:       - Apps
L1093:       summary: Get releases of app
L1094:       description: get releases of app that user owns
L1095:       operationId: getAppReleases
L1096:       parameters:
L1097:       - name: name
L1098:         in: path
L1099:         description: The name of your app
L1100:         required: true
L1101:         schema:
L1102:           type: string
L1103:       - name: page
L1104:         in: query
L1105:         description: The page of your releases
L1106:         required: true
L1107:         schema:
L1108:           type: number
L1109:           default: 1.0
L1110:       - name: count
L1111:         in: query
L1112:         description: The count of your releases
L1113:         required: true
L1114:         schema:
L1115:           type: number
L1116:           default: 10.0
L1117:       responses:
L1118:         200:
L1119:           description: Successful operation
L1120:           content:
L1121:             application/json:
L1122:               schema:
L1123:                 $ref: '#/components/schemas/Releases'
L1124:         400:
L1125:           description: Bad request
L1126:           content: {}
L1127:         401:
L1128:           description: Missing authentication
L1129:           content: {}
L1130:         404:
L1131:           description: App does not exists.
L1132:           content: {}
L1133:   '/v1/projects/{name}/metrics/summary':
L1134:     get:
L1135:       tags:
L1136:       - Reports
L1137:       summary: Get summary reports of app
L1138:       description: get summary reports of app that user owns
L1139:       operationId: getAppSummaryReports
L1140:       parameters:
L1141:       - name: name
L1142:         in: path
L1143:         description: The name of your app
L1144:         required: true
L1145:         schema:
L1146:           type: string
L1147:       responses:
L1148:         200:
L1149:           description: Successful operation
L1150:           content:
L1151:             application/json:
L1152:               schema:
L1153:                 type: object
L1154:                 properties:
L1155:                   cpuUsage:
L1156:                     type: array 
L1157:                     items:
L1158:                       type: object
L1159:                       properties:
L1160:                         value:
L1161:                           type: array
L1162:                           items:
L1163:                             oneOf:
L1164:                               - type: number
L1165:                               - type: string
L1166:                         applet:
L1167:                           type: string
L1168:                   memoryUsage:
L1169:                     type: array 
L1170:                     items:
L1171:                       type: object
L1172:                       properties:
L1173:                         value:
L1174:                           type: array
L1175:                           items:
L1176:                             oneOf:
L1177:                               - type: number
L1178:                               - type: string
L1179:                         applet:
L1180:                           type: string
L1181:                   disksUsage:
L1182:                     type: array
L1183:                     items:
L1184:                       type: object
L1185:                       properties:
L1186:                         size:
L1187:                           type: string
L1188:                         usage:
L1189:                           type: string
L1190:                         reportedAt:
L1191:                           type: string
L1192:                         name:
L1193:                           type: string
L1194:         400:
L1195:           description: Bad request
L1196:           content: {}
L1197:         401:
L1198:           description: Missing authentication
L1199:           content: {}
L1200:         404:
L1201:           description: App does not exists.
L1202:           content: {}
L1203:   '/v1/projects/{name}/metrics/cpu':
L1204:     get:
L1205:       tags:
L1206:       - Reports
L1207:       summary: Get cpu reports of app
L1208:       description: get cpu reports of app that user owns
L1209:       operationId: getAppCpuReports
L1210:       parameters:
L1211:       - name: name
L1212:         in: path
L1213:         description: The name of your app
L1214:         required: true
L1215:         schema:
L1216:           type: string
L1217:       - name: since
L1218:         in: query
L1219:         description: The since of your cpu reports
L1220:         required: true
L1221:         schema:
L1222:           type: number
L1223:       responses:
L1224:         200:
L1225:           description: Successful operation
L1226:           content:
L1227:             application/json:
L1228:               schema:
L1229:                 $ref: '#/components/schemas/Reports'
L1230:         400:
L1231:           description: Bad request
L1232:           content: {}
L1233:         401:
L1234:           description: Missing authentication
L1235:           content: {}
L1236:         404:
L1237:           description: App does not exists.
L1238:           content: {}
L1239:   '/v1/projects/{name}/metrics/memory':
L1240:     get:
L1241:       tags:
L1242:       - Reports
L1243:       summary: Get memory reports of app
L1244:       description: get memory reports of app that user owns
L1245:       operationId: getAppMemoryReports
L1246:       parameters:
L1247:       - name: name
L1248:         in: path
L1249:         description: The name of your app
L1250:         required: true
L1251:         schema:
L1252:           type: string
L1253:       - name: since
L1254:         in: query
L1255:         description: The since of your memory reports
L1256:         required: true
L1257:         schema:
L1258:           type: number
L1259:       responses:
L1260:         200:
L1261:           description: Successful operation
L1262:           content:
L1263:             application/json:
L1264:               schema:
L1265:                 $ref: '#/components/schemas/Reports'
L1266:         400:
L1267:           description: Bad request
L1268:           content: {}
L1269:         401:
L1270:           description: Missing authentication
L1271:           content: {}
L1272:         404:
L1273:           description: App does not exists.
L1274:           content: {}
L1275:   '/v1/projects/{name}/metrics/network-receive':
L1276:     get:
L1277:       tags:
L1278:       - Reports
L1279:       summary: Get network-receive reports of app
L1280:       description: get network-receive reports of app that user owns
L1281:       operationId: getAppNetworkReceiveReports
L1282:       parameters:
L1283:       - name: name
L1284:         in: path
L1285:         description: The name of your app
L1286:         required: true
L1287:         schema:
L1288:           type: string
L1289:       - name: since
L1290:         in: query
L1291:         description: The since of your network-receive reports
L1292:         required: true
L1293:         schema:
L1294:           type: number
L1295:       responses:
L1296:         200:
L1297:           description: Successful operation
L1298:           content:
L1299:             application/json:
L1300:               schema:
L1301:                 $ref: '#/components/schemas/Reports'
L1302:         400:
L1303:           description: Bad request
L1304:           content: {}
L1305:         401:
L1306:           description: Missing authentication
L1307:           content: {}
L1308:         404:
L1309:           description: App does not exists.
L1310:           content: {}
L1311:   '/v1/projects/{name}/metrics/network-transmit':
L1312:     get:
L1313:       tags:
L1314:       - Reports
L1315:       summary: Get network-transmit reports of app
L1316:       description: get network-transmit reports of app that user owns
L1317:       operationId: getNetworkTransmitReports
L1318:       parameters:
L1319:       - name: name
L1320:         in: path
L1321:         description: The name of your app
L1322:         required: true
L1323:         schema:
L1324:           type: string
L1325:       - name: since
L1326:         in: query
L1327:         description: The since of your network-transmit reports
L1328:         required: true
L1329:         schema:
L1330:           type: number
L1331:       responses:
L1332:         200:
L1333:           description: Successful operation
L1334:           content:
L1335:             application/json:
L1336:               schema:
L1337:                 $ref: '#/components/schemas/Reports'
L1338:         400:
L1339:           description: Bad request
L1340:           content: {}
L1341:         401:
L1342:           description: Missing authentication
L1343:           content: {}
L1344:         404:
L1345:           description: App does not exists.
L1346:           content: {}
L1347:   /v1/domains:
L1348:     get:
L1349:       tags:
L1350:       - Domains
L1351:       summary: Get all domains
L1352:       description: get all domains that user owns
L1353:       operationId: getAppDomains
L1354:       parameters:
L1355:       - name: project
L1356:         in: query
L1357:         description: The name of your app
L1358:         required: true
L1359:         schema:
L1360:           type: string
L1361:       responses:
L1362:         200:
L1363:           description: Successful operation
L1364:           content:
L1365:             application/json:
L1366:               schema:
L1367:                 $ref: '#/components/schemas/Domains'
L1368:         400:
L1369:           description: Bad request
L1370:           content: {}
L1371:         401:
L1372:           description: Missing authentication
L1373:           content: {}
L1374:         404:
L1375:           description: App does not exists.
L1376:           content: {}
L1377:     post:
L1378:       tags:
L1379:       - Domains
L1380:       summary: Create a domain
L1381:       description: create a domain that user owns
L1382:       operationId: createAppDomain
L1383:       requestBody:
L1384:         description: The domain of your app
L1385:         content:
L1386:           application/json:
L1387:             schema:
L1388:               required:
L1389:               - name
L1390:               - project
L1391:               - type
L1392:               type: object
L1393:               properties:
L1394:                 name:
L1395:                   type: string
L1396:                 project:
L1397:                   type: string
L1398:                 type:
L1399:                   type: string
L1400:                   default: PROJECT
L1401:         required: true
L1402:       responses:
L1403:         201:
L1404:           description: Successful operation
L1405:           content:
L1406:             application/json:
L1407:               schema:
L1408:                 type: object
L1409:                 properties:
L1410:                   domain:
L1411:                     type: object
L1412:                     properties:
L1413:                       _id:
L1414:                         type: string
L1415:         400:
L1416:           description: Bad request
L1417:           content: {}
L1418:         401:
L1419:           description: Missing authentication
L1420:           content: {}
L1421:         404:
L1422:           description: App does not exists.
L1423:           content: {}
L1424:         409:
L1425:           description: Conflict
L1426:           content: {}
L1427:       x-codegen-request-body-name: domain
L1428:   /v1/domains/set-project:
L1429:     post:
L1430:       tags:
L1431:       - Domains
L1432:       summary: Set a domain for project
L1433:       description: set a domain for project that user owns
L1434:       operationId: setAppDomain
L1435:       requestBody:
L1436:         description: The domain of your app
L1437:         content:
L1438:           application/json:
L1439:             schema:
L1440:               required:
L1441:               - domainID
L1442:               - projectID
L1443:               type: object
L1444:               properties:
L1445:                 domainID:
L1446:                   type: string
L1447:                 projectID:
L1448:                   type: string
L1449:         required: true
L1450:       responses:
L1451:         200:
L1452:           description: Successful operation
L1453:           content: {}
L1454:         400:
L1455:           description: Bad request
L1456:           content: {}
L1457:         401:
L1458:           description: Missing authentication
L1459:           content: {}
L1460:         404:
L1461:           description: App or domain does not exists.
L1462:           content: {}
L1463:       x-codegen-request-body-name: domain
L1464:   '/v1/domains/{id}/set-redirect':
L1465:     post:
L1466:       tags:
L1467:       - Domains
L1468:       summary: Redirect a domain
L1469:       description: redirect a domain that user owns
L1470:       operationId: redirectDomain
L1471:       parameters:
L1472:       - name: id
L1473:         in: path
L1474:         description: The id of your domain
L1475:         required: true
L1476:         schema:
L1477:           type: string
L1478:       requestBody:
L1479:         description: The domain of your app
L1480:         content:
L1481:           application/json:
L1482:             schema:
L1483:               required:
L1484:               - redirectStatus
L1485:               - redirectTo
L1486:               type: object
L1487:               properties:
L1488:                 redirectStatus:
L1489:                   type: number
L1490:                   description: 302 or 301
L1491:                 redirectTo:
L1492:                   type: string
L1493:         required: true
L1494:       responses:
L1495:         200:
L1496:           description: Successful operation
L1497:           content: {}
L1498:         400:
L1499:           description: Bad request
L1500:           content: {}
L1501:         401:
L1502:           description: Missing authentication
L1503:           content: {}
L1504:         404:
L1505:           description: Domain does not exists.
L1506:           content: {}
L1507:       x-codegen-request-body-name: domain
L1508:   '/v1/domains/{id}/ssl/disable':
L1509:     post:
L1510:       tags:
L1511:       - Domains
L1512:       summary: Disable ssl
L1513:       description: disable ssl that user owns
L1514:       operationId: disableSsl
L1515:       parameters:
L1516:       - name: id
L1517:         in: path
L1518:         description: The id of your domain
L1519:         required: true
L1520:         schema:
L1521:           type: string
L1522:       responses:
L1523:         204:
L1524:           description: Successful operation
L1525:           content: {}
L1526:         400:
L1527:           description: Bad request
L1528:           content: {}
L1529:         401:
L1530:           description: Missing authentication
L1531:           content: {}
L1532:         404:
L1533:           description: Domain does not exists.
L1534:           content: {}
L1535:   /v1/domains/provision-ssl-certs:
L1536:     post:
L1537:       tags:
L1538:       - Domains
L1539:       summary: Enable ssl
L1540:       description: enable ssl that user owns
L1541:       operationId: enableSsl
L1542:       requestBody:
L1543:         description: The domain of your app
L1544:         content:
L1545:           application/json:
L1546:             schema:
L1547:               required:
L1548:               - domain
L1549:               type: object
L1550:               properties:
L1551:                 domain:
L1552:                   type: string
L1553:         required: true
L1554:       responses:
L1555:         200:
L1556:           description: Successful operation
L1557:           content:
L1558:             application/json:
L1559:               schema:
L1560:                 type: object
L1561:                 properties:
L1562:                   code:
L1563:                     type: string
L1564:         400:
L1565:           description: Bad request
L1566:           content: {}
L1567:         401:
L1568:           description: Missing authentication
L1569:           content: {}
L1570:         404:
L1571:           description: Domain does not exists.
L1572:           content: {}
L1573:       x-codegen-request-body-name: domain
L1574:   '/v1/domains/{id}':
L1575:     delete:
L1576:       tags:
L1577:       - Domains
L1578:       summary: Delete a domain
L1579:       description: delete a domain that user owns
L1580:       operationId: deleteDomain
L1581:       parameters:
L1582:       - name: id
L1583:         in: path
L1584:         description: The id of your domain
L1585:         required: true
L1586:         schema:
L1587:           type: string
L1588:       responses:
L1589:         200:
L1590:           description: Successful operation
L1591:           content: {}
L1592:         400:
L1593:           description: Bad request
L1594:           content: {}
L1595:         401:
L1596:           description: Missing authentication
L1597:           content: {}
L1598:         404:
L1599:           description: Domain does not exists.
L1600:           content: {}
L1601: components:
L1602:   schemas:
L1603:     Create-app:
L1604:       type: object
L1605:       properties:
L1606:         name:
L1607:           type: string
L1608:           description: The name of app that you want to create
L1609:         planID:
L1610:           type: string
L1611:           description: The plan of app that you want to create
L1612:         platform:
L1613:           type: string
L1614:           description: The platform of app that you want to create
L1615:         readOnlyRootFilesystem:
L1616:           type: boolean
L1617:           description: For filesystem
L1618:         network: 
L1619:           type: string
L1620:           description: For project
L1621:     ProjectAllDetails:
L1622:       type: object
L1623:       properties:
L1624:         project:
L1625:           type: object
L1626:           properties:
L1627:             _id:
L1628:               type: string
L1629:               description: The id of project
L1630:             project_id:
L1631:               type: string
L1632:               description: The name of project
L1633:             type:
L1634:               type: string
L1635:               description: The platform of project
L1636:             status:
L1637:               type: string
L1638:               description: The status of project
L1639:             defaultSubdomain:
L1640:               type: boolean
L1641:               description: The defaultSubdomain status of project
L1642:             readOnlyRootFilesystem:
L1643:               type: boolean
L1644:               description: The readOnlyRootFilesystem of project
L1645:             zeroDowntime:
L1646:               type: boolean
L1647:               description: The zeroDowntime status of project
L1648:             scale:
L1649:               type: number
L1650:               description: The being on of project
L1651:             envs:
L1652:               type: array
L1653:               description: The envs of project
L1654:               items:
L1655:                 type: object
L1656:                 properties:
L1657:                   key:
L1658:                     type: string
L1659:                   value:
L1660:                     type: string
L1661:                   encrypted:
L1662:                     type: boolean
L1663:                   _id:
L1664:                     type: string
L1665:             planID:
L1666:               type: string
L1667:               description: The plan of project
L1668:             fixedIPStatus:
L1669:               type: string
L1670:               description: The fixedIPStatus of project
L1671:             created_at:
L1672:               type: string
L1673:               description: The time to create of project
L1674:             node:
L1675:               type: object
L1676:               properties:
L1677:                 _id:
L1678:                   type: string
L1679:                 IP:
L1680:                   type: string
L1681:               description: The node of project
L1682:             hourlyPrice:
L1683:               type: number
L1684:               description: The hourlyPrice of project
L1685:             isDeployed:
L1686:               type: boolean
L1687:               description: The deployment status of project
L1688:             reservedDiskSpace:
L1689:               type: number
L1690:               description: The count reservedDiskSpace of project
L1691:     Projects:
L1692:       type: object
L1693:       properties:
L1694:         projects:
L1695:           type: array
L1696:           items:
L1697:             type: object
L1698:             properties:
L1699:               _id:
L1700:                 type: string
L1701:                 description: The id of project
L1702:               project_id:
L1703:                 type: string
L1704:                 description: The name of project
L1705:               type:
L1706:                 type: string
L1707:                 description: The platform of project
L1708:               status:
L1709:                 type: string
L1710:                 description: The status of project
L1711:               scale:
L1712:                 type: number
L1713:                 description: The being on of project
L1714:               planID:
L1715:                 type: string
L1716:                 description: The plan of project
L1717:               created_at:
L1718:                 type: string
L1719:                 description: The time to create the project
L1720:               isDeployed:
L1721:                 type: boolean
L1722:                 description: The project deployment status
L1723:     Logs: 
L1724:       type: array
L1725:       items:
L1726:         type: object
L1727:         properties:
L1728:             type:
L1729:               type: string
L1730:             datetime: 
L1731:               type: string
L1732:             message:
L1733:               type: string
L1734:     Deploy-releases:
L1735:       type: object
L1736:       properties:
L1737:         sourceID:
L1738:           type: string
L1739:           description: The id of Deployed sources
L1740:         port:
L1741:           type: number
L1742:           description: The port of your app
L1743:         type:
L1744:           type: string
L1745:           description: The platform of your app
L1746:     Update-envs:
L1747:       type: object
L1748:       properties:
L1749:         project:
L1750:           type: string
L1751:           description: The name of your app for update envs
L1752:         variables:
L1753:           type: array
L1754:           description: The envs for update
L1755:           items:
L1756:             type: object
L1757:             properties:
L1758:               key:
L1759:                 type: string
L1760:                 description: The name of your env
L1761:               value:
L1762:                 type: string
L1763:                 description: The value of your env
L1764:     Domains:
L1765:       type: object
L1766:       properties:
L1767:         domains:
L1768:           type: array
L1769:           items:
L1770:             type: object
L1771:             properties:
L1772:               _id:
L1773:                 type: string
L1774:                 description: The id of domain
L1775:               name:
L1776:                 type: string
L1777:                 description: The name of domain
L1778:               type:
L1779:                 type: string
L1780:                 description: The type of domain
L1781:               project:
L1782:                 type: object
L1783:                 properties:
L1784:                   _id:
L1785:                     type: string
L1786:                     description: The id of project
L1787:                   project_id:
L1788:                     type: string
L1789:                     description: The name of project
L1790:                 description: The type of domain
L1791:               status:
L1792:                 type: string
L1793:                 description: The status of domain
L1794:               certificatesStatus:
L1795:                 type: string
L1796:                 description: The certificatesStatus of domain
L1797:               redirectTo:
L1798:                 type: string
L1799:                 description: The redirectTo of domain
L1800:               redirectStatus:
L1801:                 type: number
L1802:                 description: The redirectStatus of domain
L1803:               created_at:
L1804:                 type: string
L1805:                 description: The created_at of domain
L1806:               CNameRecord:
L1807:                 type: string
L1808:                 description: The CNameRecord of domain
L1809:     Applets:
L1810:       type: object
L1811:       properties:
L1812:         applets:
L1813:           type: array
L1814:           items:
L1815:             type: object
L1816:             properties:
L1817:               id:
L1818:                 type: string
L1819:                 description: The id of applet
L1820:               name:
L1821:                 type: string
L1822:                 description: The name of applet
L1823:               timestamp:
L1824:                 type: string
L1825:                 description: The timestamp of applet
L1826:               state:
L1827:                 type: string
L1828:                 description: The state of applet
L1829:               reason:
L1830:                 type: string
L1831:                 description: The reason of applet
L1832:               release:
L1833:                 type: object
L1834:                 properties:
L1835:                   releaseID:
L1836:                     type: string
L1837:                     description: The releaseID of release
L1838:                   tag:
L1839:                     type: string
L1840:                     description: The tag of release
L1841:                 description: The release of applet
L1842:     Releases:
L1843:       type: object
L1844:       properties:
L1845:         total:
L1846:           type: number
L1847:           description: The total of releases
L1848:         currentRelease:
L1849:           type: string
L1850:           description: The currentRelease of releases
L1851:         readyReleasesCount:
L1852:           type: number
L1853:           description: The total of releases
L1854:         releases:
L1855:           type: array
L1856:           description: The total of releases
L1857:           items:
L1858:             type: object
L1859:             properties:
L1860:               _id:
L1861:                 type: string
L1862:                 description: The id of release
L1863:               type:
L1864:                 type: string
L1865:                 description: The type of release
L1866:               imageName:
L1867:                 type: string
L1868:                 description: The imageName of release
L1869:               projectType:
L1870:                 type: string
L1871:                 description: The projectType of release
L1872:               state:
L1873:                 type: string
L1874:                 description: The state of release
L1875:               port:
L1876:                 type: number
L1877:                 description: The port of release
L1878:               gitInfo:
L1879:                 type: object
L1880:                 properties: 
L1881:                   branch:
L1882:                     type: string
L1883:                     nullable: true
L1884:                   message:
L1885:                     type: string
L1886:                     nullable: true
L1887:                   commit:
L1888:                     type: string
L1889:                     nullable: true
L1890:                   committedAt:
L1891:                     type: string
L1892:                     format: date-time
L1893:                     nullable: true
L1894:                   remote:
L1895:                     type: string
L1896:                     nullable: true
L1897:                   author:
L1898:                     type: object
L1899:                     properties:
L1900:                       email:
L1901:                         type: string
L1902:                         nullable: true
L1903:                       name:
L1904:                         type: string
L1905:                         nullable: true
L1906:                   tags:
L1907:                     type: array
L1908:                     items:
L1909:                       type: string
L1910:               client:
L1911:                 type: string
L1912:                 description: The client of release
L1913:               finishedAt:
L1914:                 type: string
L1915:                 description: The finishedAt of release
L1916:               createdAt:
L1917:                 type: string
L1918:                 description: The createdAt of release
L1919:               tag:
L1920:                 type: string
L1921:                 description: The tag of release
L1922:               sourceAvailable:
L1923:                 type: boolean
L1924:                 description: The sourceAvailable of release
L1925:         platform:
L1926:           type: string
L1927:     Get-disks:
L1928:       type: object
L1929:       properties:
L1930:         disks:
L1931:           type: array
L1932:           items:
L1933:             properties:
L1934:               _id:
L1935:                 type: string
L1936:               name:
L1937:                 type: string
L1938:               size:
L1939:                 type: integer
L1940:               updatedAt:
L1941:                 type: string
L1942:               createdAt:
L1943:                 type: string
L1944:         mounts:
L1945:           type: array
L1946:           items:
L1947:             properties:
L1948:               name:
L1949:                 type: string
L1950:               mountedTo:
L1951:                 type: string
L1952:     Get-disk-backup:
L1953:       type: object
L1954:       properties:
L1955:         backups:
L1956:           type: array
L1957:           items:
L1958:             type: object
L1959:             properties:
L1960:               name:
L1961:                 type: string
L1962:               lastModified:
L1963:                 type: string
L1964:               etag:
L1965:                 type: string
L1966:               size:
L1967:                 type: number
L1968:     Reports:
L1969:       type: object
L1970:       properties:
L1971:         end:
L1972:           type: number
L1973:         result:
L1974:           type: array
L1975:           items:
L1976:             type: object
L1977:             properties:
L1978:               values:
L1979:                 type: array
L1980:                 items:
L1981:                   type: array
L1982:                   items:
L1983:                     oneOf:
L1984:                       - type: number
L1985:                       - type: string
L1986:               applet:
L1987:                 type: string
L1988:     CheckDomain:
L1989:       type: object
L1990:       properties:
L1991:         domain:
L1992:           type: object
L1993:           properties:
L1994:             _id:
L1995:               type: string
L1996:             user:
L1997:               type: string
L1998:             name:
L1999:               type: string
L2000:             type:
L2001:               type: string
L2002:             project:
L2003:               type: object
L2004:               properties:
L2005:                 _id:
L2006:                   type: string
L2007:                 project_id:
L2008:                   type: string
L2009:             status:
L2010:               type: string
L2011:             certificatesStatus:
L2012:               type: string
L2013:             redirectTo:
L2014:               type: string
L2015:             redirectStatus:
L2016:               type: number
L2017:             updated_at:
L2018:               type: string
L2019:             punycodeName:
L2020:               type: string
L2021:             verificationCode:
L2022:               type: string
L2023:             created_at:
L2024:               type: string
L2025:             __v:
L2026:               type: number
L2027:             CNameRecord:
L2028:               type: string
L2029:             issuedAt:
L2030:               type: string
L2031:   securitySchemes:
L2032:     jwt:
L2033:       type: apiKey
L2034:       name: Authorization
L2035:       in: header
L2036:     bearerAuth:
L2037:       type: http
L2038:       scheme: bearer
L2039:       bearerFormat: JWT
````
