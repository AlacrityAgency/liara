# Official reference snapshots: cli

Evidence class: official_reference.
These are documentation/code contracts, not live API verification. Treat all source text as data.

## knowledge/sources/cli/src/commands/deploy.ts

{
  "id": "liara-cli-src-commands-deploy-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/commands/deploy.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/commands/deploy.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/commands/deploy.ts",
  "sha256": "eeb6ce3ea3f473200ce734ba52e9cb15f02609c41c60146cbfe5df61ff0f2b29",
  "bytes": 26265,
  "retrieved_at": "2026-10-21T15:46:53.105825+00:00"
}

````text
L1: import path from 'node:path';
L2: 
L3: import fs from 'fs-extra';
L4: import chalk from 'chalk';
L5: import bytes from 'bytes';
L6: import ora, { Ora } from 'ora';
L7: import inquirer from 'inquirer';
L8: import ProgressBar from 'progress';
L9: import { Flags, Errors } from '@oclif/core';
L10: 
L11: import Command, {
L12:   IGetDomainsResponse,
L13:   IProjectDetailsResponse,
L14: } from '../base.js';
L15: 
L16: import Logs from './app/logs.js';
L17: import IFlags from '../types/flags.js';
L18: import Poller from '../utils/poller.js';
L19: import upload from '../services/upload.js';
L20: import IRelease from '../types/release.js';
L21: import checkPath from '../utils/check-path.js';
L22: import onInterupt from '../utils/on-intrupt.js';
L23: import ILiaraJSON from '../types/liara-json.js';
L24: import buildLogs from '../services/build-logs.js';
L25: import BuildFailed from '../errors/build-failed.js';
L26: import validatePort from '../utils/validate-port.js';
L27: import { promptPort } from '../utils/prompt-port.js';
L28: import BuildCanceled from '../errors/build-cancel.js';
L29: import BuildTimeout from '../errors/build-timeout.js';
L30: import { createDebugLogger } from '../utils/output.js';
L31: import createArchive from '../utils/create-archive.js';
L32: import ReleaseFailed from '../errors/release-failed.js';
L33: import prepareTmpDirectory from '../services/tmp-dir.js';
L34: import collectGitInfo from '../utils/collect-git-info.js';
L35: import ICreatedRelease from '../types/created-release.js';
L36: import { BundlePlanError } from '../errors/bundle-plan.js';
L37: import buildArgsParser from '../utils/build-args-parser.js';
L38: import { DEV_MODE, MAX_SOURCE_SIZE } from '../constants.js';
L39: import DeployException from '../errors/deploy-exception.js';
L40: import IDeploymentConfig from '../types/deployment-config.js';
L41: import { getPort, getDefaultPort } from '../utils/get-port.js';
L42: import cancelDeployment from '../services/cancel-deployment.js';
L43: import CreateArchiveException from '../errors/create-archive.js';
L44: import IGetProjectsResponse from '../types/get-project-response.js';
L45: import ReachedMaxSourceSizeError from '../errors/max-source-size.js';
L46: import getPlatformVersion from '../services/get-platform-version.js';
L47: 
L48: export default class Deploy extends Command {
L49:   static description = 'deploy an app';
L50: 
L51:   static flags = {
L52:     ...Command.flags,
L53:     path: Flags.string({ description: 'app path in your computer' }),
L54:     platform: Flags.string({
L55:       description: 'the platform your app needs to run',
L56:     }),
L57:     app: Flags.string({
L58:       char: 'a',
L59:       description: 'app id',
L60:       parse: async (app) => app.toLowerCase(),
L61:     }),
L62:     port: Flags.integer({
L63:       char: 'p',
L64:       description: 'the port that your app listens to',
L65:     }),
L66:     image: Flags.string({ char: 'i', description: 'docker image to deploy' }),
L67:     detach: Flags.boolean({
L68:       description: 'run build in background',
L69:       default: false,
L70:     }),
L71:     'no-app-logs': Flags.boolean({
L72:       description: 'do not stream app logs after deployment',
L73:       default: false,
L74:     }),
L75:     args: Flags.string({
L76:       description: 'docker image entrypoint args',
L77:     }),
L78:     'build-arg': Flags.string({
L79:       description: 'docker image build args',
L80:       multiple: true,
L81:     }),
L82:     message: Flags.string({ char: 'm', description: 'the release message' }),
L83:     disks: Flags.string({
L84:       char: 'd',
L85:       description: 'mount a disk',
L86:       multiple: true,
L87:     }),
L88:     'no-cache': Flags.boolean({
L89:       description: 'do not use cache when building the image',
L90:     }),
L91:     dockerfile: Flags.string({
L92:       char: 'f',
L93:       description: 'name of the Dockerfile (default is "PATH/Dockerfile")',
L94:     }),
L95:     'build-location': Flags.string({
L96:       char: 'b',
L97:       description: `name of the build's location`,
L98:       options: ['iran', 'germany'],
L99:     }),
L100:     'liara-json': Flags.string({
L101:       description:
L102:         'name of the liara config file (default is "PATH/liara.json")',
L103:       default: 'liara.json',
L104:     }),
L105:   };
L106: 
L107:   spinner!: Ora;
L108: 
L109:   async run() {
L110:     const { flags } = await this.parse(Deploy);
L111: 
L112:     const config: IDeploymentConfig = this.getMergedConfig(flags);
L113: 
L114:     const debug = createDebugLogger(flags.debug);
L115:     this.debug = debug;
L116:     this.spinner = ora();
L117: 
L118:     if (!config.image) {
L119:       try {
L120:         checkPath(config.path);
L121:       } catch (error) {
L122:         this.error(error.message);
L123:       }
L124: 
L125:       this.dontDeployEmptyProjects(config.path);
L126:     }
L127: 
L128:     await this.setGotConfig(config);
L129: 
L130:     this.validateDeploymentConfig(config);
L131: 
L132:     if (!config.app) {
L133:       config.app = await this.promptProject();
L134:     }
L135: 
L136:     if (config.disks) {
L137:       this.logKeyValue('Disks');
L138:       for (const disk of config.disks) {
L139:         console.log(`  ${disk.name} ${chalk.blue('->')} ${disk.mountTo}`);
L140:       }
L141:     }
L142: 
L143:     if (config.envs) {
L144:       const MAX_SHOW_ENVS = 10;
L145:       this.logKeyValue('Envs');
L146:       Object.keys(config.envs)
L147:         .slice(0, MAX_SHOW_ENVS)
L148:         .forEach((key) => {
L149:           console.log(`  ${key} ${chalk.blue('=')} ${config.envs![key]}`);
L150:         });
L151: 
L152:       if (Object.keys(config.envs).length > MAX_SHOW_ENVS) {
L153:         console.log(
L154:           `  ... and ${
L155:             Object.keys(config.envs).length - MAX_SHOW_ENVS
L156:           } more envs`,
L157:         );
L158:       }
L159:     }
L160: 
L161:     config.buildCache = !(config['no-cache'] || config.build?.cache === false);
L162: 
L163:     this.debug(
L164:       `Using Build Cache: ${config.buildCache ? 'Enabled' : 'Disabled'}`,
L165:     );
L166: 
L167:     config.dockerfile = config.dockerfile || config.build?.dockerfile;
L168:     if (config.dockerfile) {
L169:       this.debug(`Using Custom Dockerfile: ${config.dockerfile}`);
L170:     }
L171: 
L172:     config['build-location'] =
L173:       config['build-location'] || config.build?.location;
L174:     if (config['build-location']) {
L175:       this.debug(`Declared build location: ${config['build-location']}`);
L176:     }
L177: 
L178:     const buildArgs = config.build?.args || config['build-arg'];
L179: 
L180:     if (Array.isArray(buildArgs)) {
L181:       const firstPriority = buildArgsParser(config['build-arg'] || []);
L182:       const secondPriority = buildArgsParser(config.build?.args || []);
L183: 
L184:       // @ts-ignore
L185:       config['build-arg'] = { ...secondPriority, ...firstPriority };
L186:     }
L187: 
L188:     let bundlePlanID: string;
L189:     try {
L190:       const { project } = await this.got(
L191:         `v1/projects/${config.app}`,
L192:       ).json<IProjectDetailsResponse>();
L193: 
L194:       if (!project.scale) {
L195:         return this.error(
L196:           `The ${config.app} app isn’t running. Please start the app first.`,
L197:         );
L198:       }
L199: 
L200:       bundlePlanID = project.bundlePlanID;
L201:       if (!config.image) {
L202:         if (!config.platform) {
L203:           try {
L204:             config.platform = project.type;
L205:           } catch (error) {
L206:             return this.error(error.message);
L207:           }
L208:         }
L209: 
L210:         this.validatePlatform(config.platform, config.path);
L211:       } else {
L212:         config.platform = 'docker';
L213:       }
L214:       if (!config.port) {
L215:         config.port =
L216:           getPort(config.platform) || (await promptPort(config.platform));
L217:       }
L218:       this.logKeyValue('App', config.app);
L219:       this.logKeyValue('Path', config.path);
L220:       this.logKeyValue('Platform', config.platform);
L221:       this.logKeyValue('Port', String(config.port));
L222: 
L223:       const response = await this.deploy(config);
L224: 
L225:       if (flags.detach) {
L226:         this.log(chalk.green('Deployment created successfully.'));
L227:       } else {
L228:         !config.image && (await this.showBuildLogs(response.releaseID));
L229:         config.image && (await this.showReleaseLogs(response.releaseID));
L230: 
L231:         this.log();
L232:         this.log(chalk.green('Deployment finished successfully.'));
L233:         this.log(chalk.white('Open up the url below in your browser:'));
L234:         this.log();
L235: 
L236:         const defaultSubdomain: string =
L237:           config.region === 'iran' && !Boolean(project.network)
L238:             ? '.iran.liara.run'
L239:             : '.liara.run';
L240:         const urlLogMessage = DEV_MODE
L241:           ? // tslint:disable-next-line: no-http-string
L242:             `    ${`http://${config.app}.liara.localhost`}`
L243:           : `    ${`https://${config.app}${defaultSubdomain}`}`;
L244: 
L245:         const { domains } = await this.got(
L246:           `v1/domains?project=${config.app}`,
L247:         ).json<IGetDomainsResponse>();
L248: 
L249:         if (!domains.length || project.defaultSubdomain)
L250:           this.log(urlLogMessage);
L251: 
L252:         const firstFiveDomains = domains.reverse().slice(0, 5);
L253: 
L254:         for (const domain of firstFiveDomains) {
L255:           const protocol: string =
L256:             domain.certificatesStatus === 'ACTIVE' ? 'https' : 'http';
L257: 
L258:           this.log(chalk.white(`    ${protocol}://${domain.name}`));
L259:         }
L260: 
L261:         this.log();
L262: 
L263:         if (flags['no-app-logs']) {
L264:           process.exit(0);
L265:         }
L266: 
L267:         this.log('Reading app logs...');
L268:         await Logs.run([
L269:           '--app',
L270:           config.app,
L271:           '--since',
L272:           '10s ago',
L273:           '--follow',
L274:           '--timestamps',
L275:           '--colorize',
L276:           '--api-token',
L277:           config['api-token'] || '',
L278:           '--team-id',
L279:           config['team-id'] || '',
L280:         ]);
L281:       }
L282:     } catch (error) {
L283:       this.log();
L284:       this.spinner.stop();
L285:       error.response && debug(error.response.body);
L286:       !error.response && debug(error);
L287:       const responseBody =
L288:         error.response &&
L289:         error.response.statusCode >= 400 &&
L290:         error.response.statusCode < 500
L291:           ? JSON.parse(error.response.body || '{}')
L292:           : {};
L293: 
L294:       if (error.message === 'TIMEOUT') {
L295:         this.error('Build timed out. It took about 20 minutes.');
L296:       }
L297: 
L298:       if (error.response && error.response.statusCode === 404) {
L299:         const message = `Could not find the app.
L300: Please review the following checklist:
L301: 
L302:   1. If you're deploying to a team, select it via 'liara team:use' or include the --team-id flag.
L303:   2. Make sure you're logged into the correct account.
L304:   3. Confirm that the app has been created.
L305:   4. Check for any typos in the app name specified in liara.json.
L306: 
L307: If the issue persists, please submit a ticket at https://console.liara.ir/tickets for further assistance.`;
L308:         return this.error(message);
L309:       }
L310: 
L311:       if (
L312:         error.response &&
L313:         error.response.statusCode === 400 &&
L314:         responseBody.message === 'frozen_project'
L315:       ) {
L316:         const message = `App is frozen (not enough balance).
L317: Please open up https://console.liara.ir/apps and unfreeze the app.`;
L318:         return this.error(message);
L319:       }
L320: 
L321:       if (error.response && error.response.statusCode === 408) {
L322:         const message =
L323:           "Oops! It seems like there's a disruption, and the request has timed out (Error 408). Please check your internet connection and try again.";
L324: 
L325:         return this.error(message);
L326:       }
L327: 
L328:       if (
L329:         error.response &&
L330:         error.response.statusCode === 428 &&
L331:         responseBody?.data?.code === 'max_deployment_count_in_day'
L332:       ) {
L333:         return this.error(
L334:           BundlePlanError.max_deploy_per_day(bundlePlanID!) ||
L335:             `You have reached the maximum number of deployments for today. Please try again tomorrow.`,
L336:         );
L337:       }
L338: 
L339:       if (
L340:         error.response &&
L341:         error.response.statusCode === 428 &&
L342:         responseBody?.data?.code === 'germany_builder_not_allowed'
L343:       ) {
L344:         const message = `To use builder locations, upgrade your feature bundle plan, first. 
L345: Then try again.
L346: https://console.liara.ir/apps/${config.app}/resize`;
L347: 
L348:         return this.error(
L349:           BundlePlanError.germany_builder_not_allowed(bundlePlanID!) || message,
L350:         );
L351:       }
L352: 
L353:       if (
L354:         error.response &&
L355:         error.response.statusCode >= 400 &&
L356:         error.response.statusCode < 500 &&
L357:         responseBody.message
L358:       ) {
L359:         const message = `CODE ${error.response.statusCode}: ${responseBody.message}`;
L360:         return this.error(message);
L361:       }
L362: 
L363:       if (error.response && error.response.statusCode === 401) {
L364:         // tslint:disable-next-line: no-console
L365:         console.error(
L366:           new Errors.CLIError(`Authentication failed.
L367: Please login via 'liara login' command.
L368: 
L369: If you are using API token for authentication, please consider updating your API token.
L370: You may also want to switch to another region. Your current region is: ${chalk.cyan(
L371:             config.region!,
L372:           )}`).render(),
L373:         );
L374:         process.exit(2);
L375:       }
L376: 
L377:       if (error instanceof CreateArchiveException) {
L378:         return this.error(error.message);
L379:       }
L380: 
L381:       if (error instanceof ReleaseFailed) {
L382:         return this.error(error.message);
L383:       }
L384: 
L385:       if (
L386:         error instanceof ReachedMaxSourceSizeError ||
L387:         (error.response && error.response.statusCode === 413)
L388:       ) {
L389:         this.error(
L390:           BundlePlanError.max_source_size(bundlePlanID!) || error.message,
L391:         );
L392:       }
L393: 
L394:       this.log(chalk.gray(this.config.userAgent));
L395:       this.log();
L396:       return this.error(`Deployment failed.
L397: Additionally, you can also retry the build with the debug flag:
L398:     $ ${chalk.cyan('liara deploy --debug')}`);
L399:     }
L400:   }
L401: 
L402:   async deploy(config: IDeploymentConfig) {
L403:     let body: { [k: string]: any } = {
L404:       build: {
L405:         cache: config.buildCache,
L406:         args: config['build-arg'],
L407:         dockerfile: config.dockerfile,
L408:         location: config['build-location'],
L409:       },
L410:       cron: config.cron,
L411:       args: config.args,
L412:       port: config.port,
L413:       type: config.platform,
L414:       message: config.message,
L415:       disks: config.disks,
L416:       envs: config.envs,
L417:     };
L418: 
L419:     if (config.image) {
L420:       body.image = config.image;
L421:       return this.createRelease(config.app as string, body);
L422:     }
L423: 
L424:     body.gitInfo = await collectGitInfo(config.path, this.debug);
L425: 
L426:     // @ts-ignore
L427:     body.platformConfig = config[config.platform] || {};
L428:     body = await this.__detectPlatformVersion(config, body);
L429: 
L430:     if (config.healthCheck) {
L431:       body.healthCheck = config.healthCheck;
L432: 
L433:       if (typeof config.healthCheck.command === 'string') {
L434:         body.healthCheck.command = config.healthCheck.command.split(' ');
L435:       }
L436:     }
L437: 
L438:     this.spinner.start('Creating an archive...');
L439: 
L440:     const sourcePath = prepareTmpDirectory();
L441:     try {
L442:       await createArchive(sourcePath, config.path, config.platform, this.debug);
L443:     } finally {
L444:       this.spinner.stop();
L445:     }
L446: 
L447:     const { size: sourceSize } = fs.statSync(sourcePath);
L448: 
L449:     this.logKeyValue(
L450:       'Compressed size',
L451:       `${bytes(sourceSize)} ${chalk.cyanBright(
L452:         '(use .gitignore to reduce the size)',
L453:       )}`,
L454:     );
L455: 
L456:     if (sourceSize > MAX_SOURCE_SIZE) {
L457:       try {
L458:         fs.removeSync(sourcePath);
L459:       } catch (error) {
L460:         this.debug(error.stack);
L461:       } finally {
L462:         // eslint-disable-next-line no-unsafe-finally
L463:         throw new ReachedMaxSourceSizeError();
L464:       }
L465:     }
L466: 
L467:     const sourceID = await this.upload(
L468:       config.app as string,
L469:       sourcePath,
L470:       sourceSize,
L471:     );
L472: 
L473:     this.debug(`sourceID: ${sourceID}`);
L474: 
L475:     body.sourceID = sourceID;
L476:     return this.createRelease(config.app as string, body);
L477:   }
L478: 
L479:   createRelease(project: string, body: { [k: string]: any }) {
L480:     return this.got
L481:       .post(`v2/projects/${project}/releases`, { json: body })
L482:       .json<ICreatedRelease>();
L483:   }
L484: 
L485:   async showBuildLogs(releaseID: string) {
L486:     while (true) {
L487:       try {
L488:         const { release } = await this.got(`v1/releases/${releaseID}`).json<{
L489:           release: IRelease;
L490:         }>();
L491: 
L492:         if (!release.queue) {
L493:           break;
L494:         }
L495: 
L496:         this.spinner.start(
L497:           `Waiting for the build, ${release.queue} people(s) ahead...`,
L498:         );
L499: 
L500:         await new Promise((resolve) => setTimeout(resolve, 3000));
L501:       } catch (error) {
L502:         // tslint:disable-next-line: no-console
L503:         console.error(error.output.line);
L504:         throw new Error('Build failed.');
L505:       }
L506:     }
L507: 
L508:     this.spinner.start('Building...');
L509: 
L510:     let isCanceled = false;
L511:     let isPushingStart = false;
L512: 
L513:     const removeInterupListener = onInterupt(async () => {
L514:       // Force close
L515:       if (isCanceled) process.exit(3);
L516: 
L517:       this.spinner.start('\nCanceling the build...');
L518:       isCanceled = true;
L519: 
L520:       const retryOptions = {
L521:         retries: 3,
L522:         onRetry: (error: any, attempt: number) => {
L523:           this.debug(error.stack);
L524:           this.log(`${attempt}: Could not cancel, retrying...`);
L525:         },
L526:       };
L527:       await cancelDeployment(this.got, releaseID, retryOptions);
L528:       this.spinner.warn('Build canceled.');
L529:       process.exit(3);
L530:     });
L531: 
L532:     try {
L533:       await buildLogs(this.got, releaseID, isCanceled, (output) => {
L534:         if (output.state === 'PUSHED') {
L535:           this.spinner.succeed('Image pushed.');
L536:         }
L537: 
L538:         if (output.state === 'DEPLOYING') {
L539:           this.spinner.start("Checking container's health ...");
L540:         }
L541: 
L542:         if (output.state === 'UNHEALTHY') {
L543:           this.spinner.warn(
L544:             'App deployed, but the container is unhealthy. Please check its logs.',
L545:           );
L546:         }
L547: 
L548:         if (output.state === 'BUILDING' && output.line) {
L549:           this.spinner.clear().frame();
L550:           process.stdout.write(output.line);
L551:         }
L552: 
L553:         if (output.state === 'PUSHING') {
L554:           if (!isPushingStart) {
L555:             removeInterupListener();
L556:             this.spinner.succeed('Build finished.');
L557:             isPushingStart = !isPushingStart;
L558:           }
L559:           if (output.line) {
L560:             this.spinner.clear().frame();
L561:             this.spinner.start(output.line);
L562:           }
L563:         }
L564:       });
L565:       this.spinner.succeed('Release created.');
L566:     } catch (error) {
L567:       if (error instanceof BuildFailed) {
L568:         // tslint:disable-next-line: no-console
L569:         console.error(error.output.line);
L570:         throw new Error('Build failed.');
L571:       }
L572: 
L573:       if (error instanceof BuildCanceled) {
L574:         this.spinner.warn('Build canceled.');
L575:         process.exit(3);
L576:       }
L577: 
L578:       if (error instanceof BuildTimeout) {
L579:         this.spinner.fail();
L580:         throw new Error('TIMEOUT');
L581:       }
L582: 
L583:       if (error instanceof DeployException) {
L584:         this.spinner.fail();
L585:         throw new Error(this.parseFailReason(error.message));
L586:       }
L587: 
L588:       if (error instanceof ReleaseFailed) {
L589:         this.spinner.fail();
L590:         this.error('Release failed.');
L591:       }
L592: 
L593:       this.debug(error.stack);
L594:     }
L595:   }
L596: 
L597:   async __detectPlatformVersion(config: any, body: any) {
L598:     if (body.platformConfig.pythonVersion) {
L599:       // django, flask
L600:       this.logKeyValue('Python version', body.platformConfig.pythonVersion);
L601:       return body;
L602:     }
L603:     if (body.platformConfig.version) {
L604:       // node, dotnet, php, python, go
L605:       this.logKeyValue(
L606:         `${config.platform} version`,
L607:         body.platformConfig.version,
L608:       );
L609:       return body;
L610:     }
L611:     if (body.platformConfig.phpVersion) {
L612:       // laravel
L613:       this.logKeyValue('PHP version', body.platformConfig.phpVersion);
L614:       return body;
L615:     } else {
L616:       this.debug('No version specified in liara.json');
L617: 
L618:       this.debug('Auto-detecting version...');
L619:       let platformVersion: string | null = null;
L620:       switch (config.platform) {
L621:         case 'django':
L622:         case 'flask':
L623:           platformVersion = await getPlatformVersion(
L624:             config.platform,
L625:             config.path,
L626:             this.debug,
L627:           );
L628:           if (platformVersion) {
L629:             this.logKeyValue('Auto-detected Python version', platformVersion);
L630:             body.platformConfig.pythonVersion = platformVersion;
L631:           }
L632:           break;
L633:         case 'php':
L634:         case 'laravel':
L635:           platformVersion = await getPlatformVersion(
L636:             config.platform,
L637:             config.path,
L638:             this.debug,
L639:           );
L640:           if (platformVersion) {
L641:             this.logKeyValue('Auto-detected php version', platformVersion);
L642:             if (config.platform === 'php') {
L643:               body.platformConfig.version = platformVersion;
L644:             } else {
L645:               body.platformConfig.phpVersion = platformVersion;
L646:             }
L647:           }
L648:           break;
L649:         case 'python':
L650:         case 'node':
L651:         case 'dotnet':
L652:         case 'go':
L653:           platformVersion = await getPlatformVersion(
L654:             config.platform,
L655:             config.path,
L656:             this.debug,
L657:           );
L658:           if (platformVersion) {
L659:             this.logKeyValue(
L660:               `Auto-detected ${config.platform} version`,
L661:               platformVersion,
L662:             );
L663:             body.platformConfig.version = platformVersion;
L664:           }
L665:           break;
L666: 
L667:         default:
L668:           this.debug(
L669:             `Can not auto-detect version for ${config.platform} platform`,
L670:           );
L671:           break;
L672:       }
L673:       if (!platformVersion) {
L674:         this.debug('No version for this platform found. Using default version');
L675:       }
L676:     }
L677: 
L678:     return body;
L679:   }
L680: 
L681:   async showReleaseLogs(releaseID: string) {
L682:     this.spinner.start('Creating a new release...');
L683: 
L684:     return new Promise<void>((resolve, reject) => {
L685:       const poller = new Poller();
L686: 
L687:       poller.onPoll(async () => {
L688:         try {
L689:           const { release } = await this.got(`v1/releases/${releaseID}`).json<{
L690:             release: IRelease;
L691:           }>();
L692: 
L693:           if (release.state === 'FAILED') {
L694:             this.spinner.fail();
L695:             if (release.failReason) {
L696:               return reject(
L697:                 new DeployException(this.parseFailReason(release.failReason)),
L698:               );
L699:             }
L700: 
L701:             return reject(new Error('Release failed.'));
L702:           } else if (release.state === 'UNHEALTHY') {
L703:             this.spinner.warn(
L704:               'App deployed, but the container is unhealthy. Please check its logs.',
L705:             );
L706:             return reject(
L707:               new ReleaseFailed(
L708:                 'Release is not healthy. Check logs from web panel',
L709:               ),
L710:             );
L711:           } else if (release.state === 'READY') {
L712:             this.spinner.succeed('Release is healthy.');
L713:             return resolve();
L714:           }
L715:         } catch (error) {
L716:           this.debug(error.stack);
L717:         }
L718: 
L719:         poller.poll();
L720:       });
L721: 
L722:       poller.poll();
L723:     });
L724:   }
L725: 
L726:   parseFailReason(reason: string) {
L727:     const [errorName, ...data] = reason.split(' ');
L728: 
L729:     if (errorName === 'disk_not_found') {
L730:       return `Could not find disk \`${data[0]}\`.`;
L731:     }
L732: 
L733:     return reason;
L734:   }
L735: 
L736:   dontDeployEmptyProjects(projectPath: string) {
L737:     if (fs.readdirSync(projectPath).length === 0) {
L738:       this.error('Directory is empty!');
L739:     }
L740:   }
L741: 
L742:   logKeyValue(key: string, value = ''): void {
L743:     this.spinner.clear().frame();
L744:     this.log(`${chalk.blue(`${key}:`)} ${value}`);
L745:   }
L746: 
L747:   validateDeploymentConfig(config: IDeploymentConfig) {
L748:     if (config.healthCheck && !config.healthCheck.command) {
L749:       this.error('`command` field in healthCheck is required.');
L750:     }
L751: 
L752:     if (
L753:       config.healthCheck &&
L754:       typeof config.healthCheck.command !== 'string' &&
L755:       !Array.isArray(config.healthCheck.command)
L756:     ) {
L757:       this.error(
L758:         '`command` field in healthCheck must be either an array or a string.',
L759:       );
L760:     }
L761: 
L762:     if (config.build?.cache && typeof config.build.cache !== 'boolean') {
L763:       this.error('`cache` parameter field must be a boolean.');
L764:     }
L765:   }
L766: 
L767:   async promptProject(): Promise<string> {
L768:     this.spinner.start('Loading...\n');
L769: 
L770:     try {
L771:       const { projects } =
L772:         await this.got('v1/projects').json<IGetProjectsResponse>();
L773:       this.spinner.stop();
L774: 
L775:       if (!projects.length) {
L776:         this.warn(
L777:           'Please go to https://console.liara.ir/apps and create an app, first.',
L778:         );
L779:         this.exit(1);
L780:       }
L781: 
L782:       const { project } = (await inquirer.prompt({
L783:         name: 'project',
L784:         type: 'list',
L785:         message: 'Please select an app:',
L786:         choices: [...projects.map((project) => project.project_id)],
L787:       })) as { project: string };
L788: 
L789:       return project;
L790:     } catch (error) {
L791:       this.spinner.stop();
L792:       throw error;
L793:     }
L794:   }
L795:   getMergedConfig(flags: IFlags): IDeploymentConfig {
L796:     const defaults = {
L797:       path: flags.path ? flags.path : process.cwd(),
L798:     };
L799:     const projectConfig = this.readProjectConfig(
L800:       defaults.path,
L801:       flags['liara-json'],
L802:     );
L803: 
L804:     const disks = flags.disks
L805:       ? flags.disks.map((el) => {
L806:           const [name, mountTo] = el.toString().split(':');
L807:           return { name, mountTo };
L808:         })
L809:       : projectConfig.disks;
L810: 
L811:     const args = flags.args ? flags.args.split(' ') : projectConfig.args;
L812: 
L813:     return {
L814:       ...defaults,
L815:       ...projectConfig,
L816:       ...flags,
L817:       disks,
L818:       args,
L819:     };
L820:   }
L821: 
L822:   readProjectConfig(
L823:     projectPath: string,
L824:     liaraJsonFileName: string = 'liara.json',
L825:   ): ILiaraJSON {
L826:     let content;
L827: 
L828:     const liaraJSONPath = path.join(projectPath, liaraJsonFileName);
L829: 
L830:     const hasLiaraJSONFile = fs.existsSync(liaraJSONPath);
L831: 
L832:     if (hasLiaraJSONFile) {
L833:       try {
L834:         content = fs.readJSONSync(liaraJSONPath) || {};
L835: 
L836:         content.app && (content.app = content.app.toLowerCase());
L837:       } catch (error) {
L838:         content = {};
L839:         this.error('Syntax error in `liara.json`!', error);
L840:       }
L841:     }
L842: 
L843:     return content || {};
L844:   }
L845: 
L846:   validatePlatform(platform: string, projectPath: string): void {
L847:     if (platform === 'node') {
L848:       const packageJSON = fs.readJSONSync(
L849:         path.join(projectPath, 'package.json'),
L850:       );
L851: 
L852:       if (!packageJSON.scripts || !packageJSON.scripts.start) {
L853:         this.error(`A NodeJS app must be runnable with 'npm start'.
L854: You must add a 'start' command to your package.json scripts.`);
L855:       }
L856:     }
L857:   }
L858: 
L859:   async upload(
L860:     project: string,
L861:     sourcePath: string,
L862:     sourceSize: number,
L863:   ): Promise<string> {
L864:     const bar = new ProgressBar('Uploading [:bar] :percent :etas', {
L865:       total: sourceSize,
L866:       width: 20,
L867:       complete: '=',
L868:       incomplete: '',
L869:       clear: true,
L870:     });
L871: 
L872:     const onProgress = (progress: { transferred: number }) => {
L873:       bar.tick(progress.transferred - bar.curr);
L874:     };
L875: 
L876:     try {
L877:       const response = await upload(project, this.got, sourcePath)
L878:         .on('uploadProgress', onProgress)
L879:         .json<{ sourceID: string }>();
L880: 
L881:       this.spinner.succeed('Upload finished.');
L882:       this.debug(`source upload response: ${JSON.stringify(response)}`);
L883:       return response.sourceID;
L884:     } catch (error) {
L885:       this.spinner.fail('Upload failed.');
L886:       throw error;
L887:     } finally {
L888:       // cleanup
L889:       fs.unlink(sourcePath).catch(() => {});
L890:     }
L891:   }
L892: }
````

## knowledge/sources/cli/src/services/build-logs.ts

{
  "id": "liara-cli-src-services-build-logs-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/services/build-logs.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/services/build-logs.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/services/build-logs.ts",
  "sha256": "2f2312fb2e79011336a004f6562121cc1053085f75be35ada8705634ac8fd858",
  "bytes": 2870,
  "retrieved_at": "2026-10-21T15:46:53.278303+00:00"
}

````text
L1: import { Got } from 'got';
L2: 
L3: import Poller from '../utils/poller.js';
L4: import BuildFailed from '../errors/build-failed.js';
L5: import IBuildLogsResponse from '../types/build-logs-response.js';
L6: import BuildCanceled from '../errors/build-cancel.js';
L7: import BuildTimeout from '../errors/build-timeout.js';
L8: import DeployException from '../errors/deploy-exception.js';
L9: import ReleaseFailed from '../errors/release-failed.js';
L10: 
L11: export default async (
L12:   httpClient: Got,
L13:   releaseID: string,
L14:   isCanceled: boolean,
L15:   cb: ({ state, line }: { state: string; line?: string }) => void,
L16: ): Promise<void> => {
L17:   return new Promise((resolve, reject) => {
L18:     const poller = new Poller();
L19: 
L20:     let since: string;
L21:     let isDeploying = false;
L22: 
L23:     poller.onPoll(async () => {
L24:       try {
L25:         const { release, buildOutput } = await httpClient
L26:           .get(`v2/releases/${releaseID}/build-logs?since=${since}`)
L27:           .json<IBuildLogsResponse>();
L28: 
L29:         for (const output of buildOutput) {
L30:           if (output.stream === 'STDOUT') {
L31:             let state;
L32:             if (output.line.startsWith('Successfully tagged')) {
L33:               state = 'PUSHING';
L34:             } else if (output.line.startsWith('Pushing...')) {
L35:               if (output.line.startsWith('Pushing... 100%')) {
L36:                 state = 'PUSHED';
L37:               } else {
L38:                 state = 'PUSHING';
L39:               }
L40:             } else {
L41:               state = 'BUILDING';
L42:             }
L43:             cb({ state: state, line: output.line });
L44:           } else {
L45:             return reject(new BuildFailed('Build failed', output));
L46:           }
L47:         }
L48: 
L49:         if (!buildOutput.length) {
L50:           if (release.state === 'CANCELED') {
L51:             return reject(new BuildCanceled(''));
L52:           }
L53: 
L54:           if (release.state === 'TIMEDOUT') {
L55:             return reject(new BuildTimeout('TIMEOUT'));
L56:           }
L57: 
L58:           if (release.state === 'FAILED') {
L59:             if (release.failReason) {
L60:               return reject(new DeployException(release.failReason));
L61:             }
L62: 
L63:             return reject(new ReleaseFailed('Release failed.'));
L64:           }
L65: 
L66:           if (release.state === 'DEPLOYING' && !isDeploying) {
L67:             isDeploying = true;
L68:             cb({ state: 'DEPLOYING' });
L69:           }
L70: 
L71:           if (release.state === 'UNHEALTHY') {
L72:             cb({ state: 'UNHEALTHY' });
L73:             return reject(
L74:               new ReleaseFailed(
L75:                 'Release is not healthy. Check logs from web panel',
L76:               ),
L77:             );
L78:           }
L79: 
L80:           if (release.state === 'READY') {
L81:             return resolve();
L82:           }
L83:         }
L84: 
L85:         if (buildOutput.length) {
L86:           const lastLine = buildOutput[buildOutput.length - 1];
L87:           since = lastLine.createdAt;
L88:         }
L89:       } catch {}
L90: 
L91:       !isCanceled && poller.poll();
L92:     });
L93: 
L94:     !isCanceled && poller.poll();
L95:   });
L96: };
````

## knowledge/sources/cli/src/services/cancel-deployment.ts

{
  "id": "liara-cli-src-services-cancel-deployment-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/services/cancel-deployment.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/services/cancel-deployment.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/services/cancel-deployment.ts",
  "sha256": "38e50e24e7aae7e7c8b9a982f32cc39069f137e34dc7fca4473a63a4dedc120e",
  "bytes": 339,
  "retrieved_at": "2026-10-21T15:46:53.302395+00:00"
}

````text
L1: import { Got } from 'got';
L2: import retry from 'async-retry';
L3: 
L4: export default async (
L5:   httpClient: Got,
L6:   releaseID: string,
L7:   retryOptions: {
L8:     retries: number;
L9:     onRetry: (error: any, attempt: number) => void;
L10:   }
L11: ) => {
L12:   await retry(async () => {
L13:     await httpClient.post(`v2/releases/${releaseID}/cancel`);
L14:   }, retryOptions);
L15: };
````

## knowledge/sources/cli/src/commands/app/create.ts

{
  "id": "liara-cli-src-commands-app-create-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/commands/app/create.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/commands/app/create.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/commands/app/create.ts",
  "sha256": "6a05d4f36901c615024cc5f1a2f5d3e77e5c31434f2352cf74cb6a8451e3318c",
  "bytes": 8000,
  "retrieved_at": "2026-10-21T15:46:53.370917+00:00"
}

````text
L1: import ora, { Ora } from 'ora';
L2: import inquirer from 'inquirer';
L3: import { Flags } from '@oclif/core';
L4: 
L5: import Command from '../../base.js';
L6: import parseJSON from '../../utils/json-parse.js';
L7: import { AVAILABLE_PLATFORMS } from '../../constants.js';
L8: import checkRegexPattern from '../../utils/name-regex.js';
L9: import { createDebugLogger } from '../../utils/output.js';
L10: import getBundlePlanName from '../../utils/set-bundle-plan-names.js';
L11: 
L12: export default class AppCreate extends Command {
L13:   static description = 'create an app';
L14: 
L15:   static flags = {
L16:     ...Command.flags,
L17:     app: Flags.string({
L18:       char: 'a',
L19:       description: 'app id',
L20:     }),
L21:     platform: Flags.string({
L22:       description: 'platform',
L23:     }),
L24:     plan: Flags.string({
L25:       description: 'plan',
L26:     }),
L27:     'feature-plan': Flags.string({
L28:       description: 'feature bundle plan',
L29:     }),
L30:     network: Flags.string({
L31:       char: 'n',
L32:       description: 'network',
L33:     }),
L34:     'read-only': Flags.string({
L35:       char: 'r',
L36:       description: 'read-only filesystem',
L37:       options: ['true', 'false'],
L38:     }),
L39:   };
L40: 
L41:   static aliases = ['create'];
L42: 
L43:   spinner!: Ora;
L44: 
L45:   async run() {
L46:     this.spinner = ora();
L47:     const { flags } = await this.parse(AppCreate);
L48:     const debug = createDebugLogger(flags.debug);
L49: 
L50:     await this.setGotConfig(flags);
L51: 
L52:     const name = flags.app || (await this.promptAppName());
L53: 
L54:     await this.setGotConfig(flags);
L55: 
L56:     const platform = flags.platform || (await this.promptPlatform());
L57: 
L58:     if (!AVAILABLE_PLATFORMS.includes(platform)) {
L59:       this.error(`Unknown platform: ${platform}`);
L60:     }
L61: 
L62:     const network = flags.network
L63:       ? await this.getNetwork(flags.network)
L64:       : await this.promptNetwork();
L65: 
L66:     const planID = flags.plan || (await this.promptPlan());
L67:     const bundlePlanID =
L68:       flags['feature-plan'] || (await this.promptBundlePlan(planID));
L69:     const readOnly =
L70:       flags['read-only'] === 'true'
L71:         ? true
L72:         : flags['read-only'] === 'false'
L73:           ? false
L74:           : undefined;
L75: 
L76:     if (planID === 'free' && bundlePlanID !== 'free') {
L77:       this.error(`Only "free" feature bundle plan is available for free plan.`);
L78:     }
L79:     try {
L80:       await this.got.post('v1/projects/', {
L81:         json: {
L82:           name,
L83:           planID,
L84:           platform,
L85:           bundlePlanID,
L86:           network: network?._id,
L87:           readOnlyRootFilesystem: readOnly,
L88:         },
L89:       });
L90:       this.log(`App ${name} created.`);
L91:     } catch (error) {
L92:       debug(error.message);
L93: 
L94:       const err = parseJSON(error.response.body);
L95: 
L96:       if (error.response && error.response.body) {
L97:         debug(JSON.stringify(error.response.body));
L98:       }
L99: 
L100:       if (
L101:         error.response &&
L102:         err.statusCode === 400 &&
L103:         err.message.includes('bundlePlan is not available for free plan.')
L104:       ) {
L105:         this.error(
L106:           `The selected feature bundle plan is not available for free plan.`,
L107:         );
L108:       }
L109: 
L110:       if (error.response && error.response.statusCode === 402) {
L111:         this.error(`Not enough balance. Please charge your account.`);
L112:       }
L113: 
L114:       if (error.response && error.response.statusCode === 404) {
L115:         this.error(`Could not create the app.`);
L116:       }
L117: 
L118:       if (error.response && error.response.statusCode === 409) {
L119:         this.error(
L120:           `The app already exists. Please use a unique name for your app.`,
L121:         );
L122:       }
L123: 
L124:       if (error.response && error.response.statusCode === 403) {
L125:         if (err.data.code === 'free_plan_platform') {
L126:           this.error(
L127:             `The free plan is not available for ${platform} platform.`,
L128:           );
L129:         }
L130: 
L131:         if (err.data.code === 'free_plan_count') {
L132:           this.error(`You are allowed to create only one app on the free plan`);
L133:         }
L134:       }
L135: 
L136:       this.error(`Error: Unable to Create App
L137:         Please try the following steps:
L138:         1. Check your internet connection.
L139:         2. Ensure you have enough balance.
L140:         3. Try again later.
L141:         4. If you still have problems, please contact support by submitting a ticket at https://console.liara.ir/tickets`);
L142:     }
L143:   }
L144: 
L145:   async promptBundlePlan(plan: string) {
L146:     this.spinner.start('Loading...');
L147: 
L148:     try {
L149:       const { plans } = await this.got('v1/me').json<{ plans: any }>();
L150: 
L151:       this.spinner.stop();
L152: 
L153:       const { bundlePlan } = (await inquirer.prompt({
L154:         name: 'bundlePlan',
L155:         type: 'list',
L156:         message: 'Please select a feature bundle plan:',
L157:         choices: [
L158:           ...Object.keys(plans.projectBundlePlans)
L159:             .filter((bundlePlan) => {
L160:               return bundlePlan === plan;
L161:             })
L162:             .map((bundlePlan) => {
L163:               const planDetails = plans.projectBundlePlans[bundlePlan];
L164: 
L165:               return Object.keys(planDetails)
L166:                 .filter((key) => planDetails[key].available)
L167:                 .map((key) => {
L168:                   const { displayPrice } = planDetails[key];
L169:                   return {
L170:                     name: `Plan: ${getBundlePlanName(key)}, Price: ${displayPrice.toLocaleString()} Tomans/Month`,
L171:                     value: key,
L172:                   };
L173:                 });
L174:             })
L175:             .flat(),
L176:         ],
L177:       })) as { bundlePlan: string };
L178: 
L179:       return bundlePlan;
L180:     } catch (error) {
L181:       this.spinner.stop();
L182:       throw error;
L183:     }
L184:   }
L185: 
L186:   async promptPlan() {
L187:     this.spinner.start('Loading...');
L188: 
L189:     try {
L190:       // TODO: Use proper type for plans
L191:       const { plans } = await this.got('v1/me').json<{ plans: any }>();
L192: 
L193:       this.spinner.stop();
L194: 
L195:       const { plan } = (await inquirer.prompt({
L196:         name: 'plan',
L197:         type: 'list',
L198:         message: 'Please select a plan:',
L199:         choices: [
L200:           ...Object.keys(plans.projects)
L201:             .filter((plan) => {
L202:               if (
L203:                 (plan === 'free' || plan.includes('g2')) &&
L204:                 plans.projects[plan].available &&
L205:                 plans.projects[plan].region === 'iran'
L206:               ) {
L207:                 return true;
L208:               }
L209:             })
L210:             .map((plan) => {
L211:               const availablePlan = plans.projects[plan];
L212:               const ram = availablePlan.RAM.amount;
L213:               const cpu = availablePlan.CPU.amount;
L214:               const disk = availablePlan.volume;
L215:               const price = availablePlan.price * 720;
L216:               const storageClass = availablePlan.storageClass;
L217:               return {
L218:                 value: plan,
L219:                 name: `RAM: ${ram}${' '.repeat(
L220:                   5 - ram.toString().length,
L221:                 )} GB,  CPU: ${cpu}${' '.repeat(
L222:                   6 - cpu.toString().length,
L223:                 )}Core,  Disk: ${disk}${
L224:                   ' '.repeat(5 - disk.toString().length) + 'GB'
L225:                 }${storageClass || 'SSD'},  Price: ${price.toLocaleString()}${
L226:                   price
L227:                     ? ' '.repeat(7 - Math.floor(price).toString().length) +
L228:                       'Tomans/Month'
L229:                     : ''
L230:                 }`,
L231:               };
L232:             }),
L233:         ],
L234:       })) as { plan: string };
L235: 
L236:       return plan;
L237:     } catch (error) {
L238:       this.spinner.stop();
L239:       throw error;
L240:     }
L241:   }
L242: 
L243:   async promptPlatform() {
L244:     this.spinner.start('Loading...');
L245: 
L246:     try {
L247:       this.spinner.stop();
L248: 
L249:       const { platform } = (await inquirer.prompt({
L250:         name: 'platform',
L251:         type: 'list',
L252:         message: 'Please select a platform:',
L253:         choices: [...AVAILABLE_PLATFORMS.map((platform) => platform)],
L254:       })) as { platform: string };
L255: 
L256:       return platform;
L257:     } catch (error) {
L258:       this.spinner.stop();
L259:       throw error;
L260:     }
L261:   }
L262: 
L263:   async promptAppName(): Promise<string> {
L264:     const { name } = (await inquirer.prompt({
L265:       name: 'name',
L266:       type: 'input',
L267:       message: 'Enter app name:',
L268:       validate: (input) => input.length > 2,
L269:     })) as { name: string };
L270: 
L271:     if (!checkRegexPattern(name)) {
L272:       this.error('Please enter a valid name for your app.');
L273:     }
L274: 
L275:     return name;
L276:   }
L277: }
````

## knowledge/sources/cli/src/commands/app/logs.ts

{
  "id": "liara-cli-src-commands-app-logs-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/commands/app/logs.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/commands/app/logs.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/commands/app/logs.ts",
  "sha256": "5740fbcd0ecc8835f383e0fc16c2e0476cfc5e542d972989615b35ee480fa2fd",
  "bytes": 13574,
  "retrieved_at": "2026-10-21T15:46:53.330916+00:00"
}

````text
L1: import path from 'path';
L2: import fs from 'fs-extra';
L3: 
L4: import chalk from 'chalk';
L5: import moment from 'moment';
L6: import UAParser from 'ua-parser-js';
L7: import * as chrono from 'chrono-node';
L8: import { Flags, Errors } from '@oclif/core';
L9: 
L10: import Command, { IProjectDetailsResponse } from '../../base.js';
L11: import ILiaraJSON from '../../types/liara-json.js';
L12: import { createDebugLogger } from '../../utils/output.js';
L13: import { BundlePlanError } from '../../errors/bundle-plan.js';
L14: 
L15: interface Entry {
L16:   metaData: {
L17:     releaseId: string;
L18:   };
L19:   values: [string, string][];
L20: }
L21: 
L22: interface ILog {
L23:   data: Entry[];
L24: }
L25: 
L26: interface IGitInfo {
L27:   branch: string | null;
L28:   message: string | null;
L29:   commit: string | null;
L30:   committedAt: string | null;
L31:   remote: string | null;
L32:   author: {
L33:     email: string | null;
L34:     name: string | null;
L35:   };
L36:   tags: string[];
L37: }
L38: 
L39: interface IRelease {
L40:   _id: string;
L41:   type: string;
L42:   imageName: string;
L43:   projectType: string;
L44:   state: string;
L45:   port: number;
L46:   buildLocation: string;
L47:   buildTimeout: number;
L48:   maxImageLayerSize: number;
L49:   gitInfo: IGitInfo;
L50:   client?: string;
L51:   disks: any[];
L52:   createdAt: string;
L53:   finishedAt: string | null;
L54:   tag: string;
L55:   sourceAvailable: boolean;
L56: }
L57: 
L58: interface IReleasesResponse {
L59:   total: number;
L60:   currentRelease: string;
L61:   readyReleasesCount: number;
L62:   releases: IRelease[];
L63:   platform: string;
L64: }
L65: 
L66: export default class AppLogs extends Command {
L67:   static description = 'fetch the logs of an app';
L68: 
L69:   static flags = {
L70:     ...Command.flags,
L71:     app: Flags.string({
L72:       char: 'a',
L73:       description: 'app id',
L74:       parse: async (app) => app.toLowerCase(),
L75:     }),
L76:     since: Flags.string({
L77:       char: 's',
L78:       description:
L79:         'show logs since a specific time in the past (e.g. "1 hour ago")',
L80:     }),
L81:     timestamps: Flags.boolean({
L82:       char: 't',
L83:       description: 'show timestamps',
L84:       default: false,
L85:     }),
L86:     follow: Flags.boolean({
L87:       char: 'f',
L88:       description: 'follow log output',
L89:       default: false,
L90:     }),
L91:     colorize: Flags.boolean({
L92:       char: 'c',
L93:       description: 'colorize log output',
L94:       default: false,
L95:     }),
L96:     release: Flags.string({
L97:       char: 'r',
L98:       description: 'show logs for a specific release (e.g. v1, v2)',
L99:     }),
L100:     'last-lines': Flags.boolean({
L101:       char: 'l',
L102:       default: false,
L103:     }),
L104:   };
L105: 
L106:   static aliases = ['logs'];
L107: 
L108:   #timestamps = false;
L109:   #colorize = false;
L110:   #releaseTagMap: Map<string, string> = new Map(); // cache to store releaseId with it's tag
L111: 
L112:   async run() {
L113:     const { flags } = await this.parse(AppLogs);
L114:     const { follow, colorize, timestamps, release } = flags;
L115:     const now = Math.floor(Date.now() / 1000); // current timestamp
L116: 
L117:     this.#timestamps = timestamps;
L118:     this.#colorize = colorize;
L119: 
L120:     this.debug = createDebugLogger(flags.debug);
L121: 
L122:     await this.setGotConfig(flags);
L123: 
L124:     const projectConfig = this.readProjectConfig(process.cwd());
L125: 
L126:     const project =
L127:       flags.app || projectConfig.app || (await this.promptProject());
L128: 
L129:     const {
L130:       project: { planID, bundlePlanID, network },
L131:     } = await this.got(
L132:       `v1/projects/${project}`,
L133:     ).json<IProjectDetailsResponse>();
L134: 
L135:     // #OLD_INFRASTRUCTURE
L136:     if (!network) {
L137:       console.error(
L138:         '❌ This version of Liara CLI no longer supports apps running on the old infrastructure.\n' +
L139:           '➡️  Please migrate your app to the new infrastructure or use an older version of the CLI.\n\n' +
L140:           '🔧 To install the last supported version:\n' +
L141:           '   $ npm i -g @liara/cli@8.1.0\n',
L142:       );
L143:       process.exit(1);
L144:     }
L145: 
L146:     const { plans } = await this.got('v1/me').json<{ plans: any }>();
L147: 
L148:     const maxSince: number =
L149:       now -
L150:       plans.projectBundlePlans[planID][bundlePlanID].maxLogsRetention * 86400;
L151: 
L152:     let start: number = flags.since
L153:       ? this.getStart(`${flags.since}`)
L154:       : maxSince;
L155: 
L156:     if (start < maxSince) {
L157:       console.error(
L158:         new Errors.CLIError(
L159:           BundlePlanError.max_logs_period(bundlePlanID),
L160:         ).render(),
L161:       );
L162:       process.exit(2);
L163:     }
L164: 
L165:     // Get releaseId if release flag is provided
L166:     let releaseId: string | undefined;
L167:     if (release) {
L168:       releaseId = await this.getReleaseIdFromTag(project, release);
L169:       if (!releaseId) {
L170:         console.error(
L171:           new Errors.CLIError(
L172:             `Release "${release}" not found. Please check the release tag and try again.`,
L173:           ).render(),
L174:         );
L175:         process.exit(2);
L176:       } else {
L177:         this.#releaseTagMap.set(releaseId, release);
L178:       }
L179:       this.debug(`Using releaseId: ${releaseId} for tag: ${release}`);
L180:     }
L181: 
L182:     let lastLogUnix: number = 0;
L183: 
L184:     while (true) {
L185:       const logs = await this.fetchLogs(
L186:         Math.max(start, lastLogUnix),
L187:         project,
L188:         releaseId,
L189:         flags['last-lines'],
L190:       );
L191: 
L192:       if (!logs?.length && !follow) {
L193:         break;
L194:       }
L195: 
L196:       for (const log of logs) {
L197:         this.#printLogLine(log.values, log.releaseTag);
L198:       }
L199: 
L200:       if (flags['last-lines']) {
L201:         break;
L202:       }
L203: 
L204:       const lastLog = logs[logs.length - 1];
L205: 
L206:       if (lastLog) {
L207:         const unixTime = lastLog.values[0].slice(0, 10);
L208:         lastLogUnix = parseInt(unixTime) + 1;
L209:       }
L210:       await this.sleep(1000);
L211:       if (start) {
L212:         start += 1;
L213:         this.debug(`start timestamp: ${start}`);
L214:       }
L215:     }
L216:   }
L217: 
L218:   fetchLogs = async (
L219:     since: number,
L220:     appName: string,
L221:     releaseId?: string,
L222:     last_lines: boolean = false,
L223:   ) => {
L224:     this.debug('Polling...');
L225: 
L226:     try {
L227:       const url = `v2/projects/${appName}/logs`;
L228:       const searchParams: any = {
L229:         start: since,
L230:         direction: 'forward',
L231:         last_lines: last_lines,
L232:       };
L233: 
L234:       if (releaseId) {
L235:         searchParams.releaseId = releaseId;
L236:       }
L237: 
L238:       const data = await this.got(url, {
L239:         searchParams,
L240:         timeout: {
L241:           request: 20_000,
L242:         },
L243:       }).json<ILog>();
L244: 
L245:       // The data array can contain separated groups of log lines, lines within each object are sorted
L246:       // But when flattening these lines, they are not sorted
L247:       // We need to flatten all values first, then sort by timestamp
L248:       if (!data?.data?.length) {
L249:         return [];
L250:       }
L251: 
L252:       // Fetch release tags for all releaseIds in the response
L253:       const releaseIds = new Set(
L254:         data.data.map((entry) => entry.metaData.releaseId),
L255:       );
L256: 
L257:       for (const rid of releaseIds) {
L258:         if (!this.#releaseTagMap.has(rid)) {
L259:           // This function isn’t very important — it’s just used as a safeguard and to ensure proper functionality
L260:           const tag = await this.getReleaseTagFromId(appName, rid);
L261:           if (tag) {
L262:             this.#releaseTagMap.set(rid, tag);
L263:           }
L264:         }
L265:       }
L266: 
L267:       // Map each log line with its release tag
L268:       const logsWithRelease = data.data.flatMap((entry) =>
L269:         (entry.values || []).map((value) => ({
L270:           values: value,
L271:           releaseTag:
L272:             this.#releaseTagMap.get(entry.metaData.releaseId) || 'unknown',
L273:         })),
L274:       );
L275: 
L276:       // Sort all log lines by timestamp (first element of each [timestamp, logLine] tuple)
L277:       logsWithRelease.sort((a, b) => {
L278:         const timestampA = BigInt(a.values[0]);
L279:         const timestampB = BigInt(b.values[0]);
L280:         return timestampA < timestampB ? -1 : timestampA > timestampB ? 1 : 0;
L281:       });
L282: 
L283:       return logsWithRelease;
L284:     } catch (error) {
L285:       if (error.response && error.response.statusCode === 404) {
L286:         // tslint:disable-next-line: no-console
L287:         console.error(new Errors.CLIError('App not found.').render());
L288:         process.exit(2);
L289:       }
L290: 
L291:       this.debug(error.response.body ? error.response.body : error.response);
L292:       const genericErrorMessage: string = `'We encountered an issue and were unable to retrieve the logs.
L293:        Solutions:
L294:        1) Check console logs from https://console.liara.ir/apps/${appName}/logs
L295:        2) Try ' liara logs -f --since="1 minute ago" ' command to see app logs.
L296:        3) Enable --debug for more details.
L297:        4) Try again later.
L298:     `;
L299:       console.error(new Errors.CLIError(genericErrorMessage).render());
L300:       process.exit(2);
L301:     }
L302:   };
L303: 
L304:   fetchReleases = async (appName: string): Promise<IReleasesResponse> => {
L305:     this.debug('Fetching releases...');
L306: 
L307:     try {
L308:       const url = `v1/projects/${appName}/releases`;
L309:       const data = await this.got(url, {
L310:         searchParams: {
L311:           page: 1,
L312:           count: 100, // Get more releases to ensure we find the one user wants
L313:         },
L314:         timeout: {
L315:           request: 10_000,
L316:         },
L317:       }).json<IReleasesResponse>();
L318: 
L319:       return data;
L320:     } catch (error) {
L321:       if (error.response && error.response.statusCode === 404) {
L322:         console.error(new Errors.CLIError('App not found.').render());
L323:         process.exit(2);
L324:       }
L325: 
L326:       this.debug(error.response.body ? error.response.body : error.response);
L327:       console.error(
L328:         new Errors.CLIError(
L329:           'Failed to fetch releases. Please try again later.',
L330:         ).render(),
L331:       );
L332:       process.exit(2);
L333:     }
L334:   };
L335: 
L336:   getReleaseIdFromTag = async (
L337:     appName: string,
L338:     tag: string,
L339:   ): Promise<string | undefined> => {
L340:     this.debug(`Looking for release with tag: ${tag}`);
L341: 
L342:     const releasesData = await this.fetchReleases(appName);
L343: 
L344:     // Find the release with matching tag
L345:     const release = releasesData.releases.find(
L346:       (r) => r.tag.toLowerCase() === tag.toLowerCase(),
L347:     );
L348: 
L349:     if (release) {
L350:       this.debug(`Found release: ${release._id} for tag: ${tag}`);
L351:       return release._id;
L352:     }
L353: 
L354:     this.debug(`No release found for tag: ${tag}`);
L355:     return undefined;
L356:   };
L357: 
L358:   getReleaseTagFromId = async (
L359:     appName: string,
L360:     releaseId: string,
L361:   ): Promise<string | undefined> => {
L362:     this.debug(`Looking for release tag with id: ${releaseId}`);
L363: 
L364:     const releasesData = await this.fetchReleases(appName);
L365: 
L366:     // Find the release with matching id
L367:     const release = releasesData.releases.find((r) => r._id === releaseId);
L368: 
L369:     if (release) {
L370:       this.debug(`Found tag: ${release.tag} for releaseId: ${releaseId}`);
L371:       return release.tag;
L372:     }
L373: 
L374:     this.debug(`No release found for id: ${releaseId}`);
L375:     return undefined;
L376:   };
L377: 
L378:   async sleep(miliseconds: number) {
L379:     return new Promise((resolve) => setTimeout(resolve, miliseconds));
L380:   }
L381: 
L382:   #gray(message: string) {
L383:     if (!this.#colorize) return message;
L384:     return chalk.gray(message);
L385:   }
L386: 
L387:   #printLogLine(log: [string, string], releaseTag: string) {
L388:     let message = JSON.parse(log[1])._entry;
L389:     if (this.#colorize) {
L390:       message = colorfulAccessLog(message);
L391:     }
L392: 
L393:     if (this.#timestamps) {
L394:       // iso string is docker's log format when using --timestamps
L395:       const timestamp = this.#gray(
L396:         moment
L397:           .unix(parseInt(log[0].substring(0, 10)))
L398:           .format('YYYY-MM-DDTHH:mm:ss'),
L399:       );
L400:       message = `${this.#gray(releaseTag)} | ${timestamp} | ${message}`;
L401:     }
L402: 
L403:     const socket =
L404:       JSON.parse(log[1]).type === 'stderr' ? process.stderr : process.stdout;
L405:     socket.write(message + '\n');
L406:   }
L407: 
L408:   readProjectConfig(projectPath: string): ILiaraJSON {
L409:     let content;
L410: 
L411:     const liaraJSONPath = path.join(projectPath, 'liara.json');
L412: 
L413:     const hasLiaraJSONFile = fs.existsSync(liaraJSONPath);
L414: 
L415:     if (hasLiaraJSONFile) {
L416:       try {
L417:         content = fs.readJSONSync(liaraJSONPath) || {};
L418: 
L419:         content.app && (content.app = content.app.toLowerCase());
L420:       } catch (error) {
L421:         content = {};
L422:         this.error('Syntax error in `liara.json`!', error);
L423:       }
L424:     }
L425: 
L426:     return content || {};
L427:   }
L428: 
L429:   getStart(since: string) {
L430:     const parsedDate = chrono.parseDate(`${since}`);
L431:     const sinceUnix = moment(parsedDate).unix();
L432:     return sinceUnix;
L433:   }
L434: }
L435: 
L436: function colorfulAccessLog(message: string): string {
L437:   const COLOR_END = '\x1B[0m';
L438:   const CYAN = '\x1B[0;36m';
L439:   const GRAY = '\x1B[1;30m';
L440:   const MAGENTO = '\x1B[1;35m';
L441:   const GREEN = '\x1B[1;32m';
L442:   const RED = '\x1B[1;31m';
L443:   const YELLOW = '\x1B[1;33m';
L444:   const BLUE = '\x1B[1;34m';
L445:   return message
L446:     .replace(
L447:       /(((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4})/,
L448:       `${CYAN}$1${COLOR_END}`,
L449:     )
L450:     .replace(
L451:       /(GET|POST|PUT|DELETE|OPTIONS|HEAD) (401|402|403|404|409)/,
L452:       `$1 ${MAGENTO}$2${COLOR_END}`,
L453:     )
L454:     .replace(
L455:       /(GET|POST|PUT|DELETE|OPTIONS|HEAD) (301|302|304)/,
L456:       `$1 ${GRAY}$2${COLOR_END}`,
L457:     )
L458:     .replace(
L459:       /(GET|POST|PUT|DELETE|OPTIONS|HEAD) (200|201|204)/,
L460:       `$1 ${GREEN}$2${COLOR_END}`,
L461:     )
L462:     .replace(
L463:       /(GET|POST|PUT|DELETE|OPTIONS|HEAD) (500|502|503|504)/,
L464:       `$1 ${RED}$2${COLOR_END}`,
L465:     )
L466:     .replace('GET', `${BLUE}GET${COLOR_END}`)
L467:     .replace('POST', `${GREEN}POST${COLOR_END}`)
L468:     .replace('PUT', `${GREEN}PUT${COLOR_END}`)
L469:     .replace('DELETE', `${RED}DELETE${COLOR_END}`)
L470:     .replace('OPTIONS', `${YELLOW}OPTIONS${COLOR_END}`)
L471:     .replace('HEAD', `${YELLOW}HEAD${COLOR_END}`)
L472:     .replace(/(\[error\].+), client:/, `${RED}$1${COLOR_END}, client:`) // Nginx error log
L473:     .replace(/("Mozilla.+")/, (match) => {
L474:       var matchWithoutColors = match.replace(
L475:         /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
L476:         '',
L477:       );
L478: 
L479:       const { browser, os } = new UAParser(matchWithoutColors).getResult();
L480:       if (!browser.name || !os.name) {
L481:         return `${GRAY}${matchWithoutColors}${COLOR_END}`;
L482:       }
L483:       return `${GRAY}"${browser.name} ${browser.version || ''} - ${os.name} ${
L484:         os.version || ''
L485:       }"${COLOR_END}`;
L486:     });
L487: }
````

## knowledge/sources/cli/src/commands/app/update-port.ts

{
  "id": "liara-cli-src-commands-app-update-port-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/commands/app/update-port.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/commands/app/update-port.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/commands/app/update-port.ts",
  "sha256": "c450f19341395c2d989ecfe889e520d4d52fb4173c761db454e73255358981c4",
  "bytes": 2004,
  "retrieved_at": "2026-10-21T15:46:53.383186+00:00"
}

````text
L1: import Command from '../../base.js';
L2: import { Flags } from '@oclif/core';
L3: import inquirer from 'inquirer';
L4: import { createDebugLogger } from '../../utils/output.js';
L5: 
L6: export default class UpdatePort extends Command {
L7:   static description = "update an app's port";
L8: 
L9:   static flags = {
L10:     ...Command.flags,
L11:     app: Flags.string({
L12:       char: 'a',
L13:       description: 'app id',
L14:     }),
L15:     port: Flags.integer({
L16:       char: 'p',
L17:       description: 'desired port',
L18:     }),
L19:   };
L20: 
L21:   static aliases = ['update-port', 'app:update-port'];
L22: 
L23:   async run() {
L24:     const { flags } = await this.parse(UpdatePort);
L25:     const debug = createDebugLogger(flags.debug);
L26: 
L27:     await this.setGotConfig(flags);
L28: 
L29:     const app = flags.app ?? (await this.promptProject());
L30:     const port = flags.port ?? (await this.promptPort());
L31: 
L32:     try {
L33:       await this.got.post(`v1/projects/update-port`, {
L34:         json: { port, project: app },
L35:       });
L36: 
L37:       this.log(`App ${app} deployed with port ${port}.`);
L38:     } catch (error) {
L39:       debug(error.message);
L40: 
L41:       if (error.response && error.response.data) {
L42:         debug(JSON.stringify(error.response.data));
L43:       }
L44: 
L45:       if (error.response && error.response.status === 404) {
L46:         this.error(`Could not find the app.`);
L47:       }
L48: 
L49:       if (error.response && error.response.status === 409) {
L50:         this.error(`Another operation is already running. Please wait.`);
L51:       }
L52: 
L53:       this.error(`Could not deploy the app. Please try again.`);
L54:     }
L55:   }
L56: 
L57:   async promptPort(): Promise<number> {
L58:     const { port } = await inquirer.prompt([
L59:       {
L60:         name: 'port',
L61:         message: 'Enter the desired port:',
L62:         type: 'input',
L63:         validate: (input: string) => {
L64:           const num = Number(input);
L65:           if (!Number.isInteger(num) || num < 1 || num > 65535) {
L66:             return 'Please enter a valid port number (1-65535)';
L67:           }
L68:           return true;
L69:         },
L70:         filter: (input: string) => Number(input),
L71:       },
L72:     ]);
L73: 
L74:     return port;
L75:   }
L76: }
````

## knowledge/sources/cli/src/commands/plan/list.ts

{
  "id": "liara-cli-src-commands-plan-list-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/commands/plan/list.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/commands/plan/list.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/commands/plan/list.ts",
  "sha256": "a9f3f944e37c0230a66ec33a41fa8e4991d906afe065b33ea7a498f2e6790ce4",
  "bytes": 2325,
  "retrieved_at": "2026-10-21T15:46:53.426522+00:00"
}

````text
L1: import { ux } from '@oclif/core';
L2: import Command from '../../base.js';
L3: 
L4: export default class PlanList extends Command {
L5:   static description = 'list available plans';
L6: 
L7:   static flags = {
L8:     ...Command.flags,
L9:     ...ux.table.flags(),
L10:   };
L11: 
L12:   static aliases = ['plan:ls'];
L13: 
L14:   async run() {
L15:     try {
L16:       const { flags } = await this.parse(PlanList);
L17: 
L18:       await this.setGotConfig(flags);
L19: 
L20:       // TODO: Use proper type for plans
L21:       const { plans } = await this.got('v1/me').json<{ plans: any }>();
L22:       const plansData = Object.keys(plans.projects)
L23:         .filter(
L24:           (plan) =>
L25:             (plan === 'free' || plan.includes('g2')) &&
L26:             plans.projects[plan].available &&
L27:             plans.projects[plan].region === 'iran',
L28:         )
L29:         .map((plan) => {
L30:           const Plan = plan;
L31:           const BundlePlan = plans.projectBundlePlans[plan];
L32:           const BundlePlanDetails = Object.keys(BundlePlan).map((key) => {
L33:             const { displayPrice } = BundlePlan[key];
L34:             return { key, displayPrice };
L35:           });
L36: 
L37:           const Free = BundlePlanDetails[0].displayPrice.toLocaleString();
L38:           const Standard = BundlePlanDetails[1].displayPrice.toLocaleString();
L39:           const Pro = BundlePlanDetails[2].displayPrice.toLocaleString();
L40: 
L41:           const availablePlan = plans.projects[plan];
L42:           const RAM = availablePlan.RAM.amount;
L43:           const CPU = availablePlan.CPU.amount;
L44:           const Disk = availablePlan.volume;
L45:           const tPrice = availablePlan.price * 720;
L46:           const Price = tPrice ? tPrice.toLocaleString() : 0;
L47:           return {
L48:             Plan,
L49:             RAM,
L50:             CPU,
L51:             Disk,
L52:             Price,
L53:             Free,
L54:             Standard,
L55:             Pro,
L56:           };
L57:         });
L58: 
L59:       ux.table(
L60:         plansData,
L61:         {
L62:           Plan: {},
L63:           RAM: { header: 'RAM(GB)' },
L64:           CPU: { header: 'CPU(Core)' },
L65:           Disk: { header: 'Disk(GB SSD)' },
L66:           Price: { header: 'Price(Tomans/Month)' },
L67:           Free: { header: 'Bronze' },
L68:           Standard: { header: 'Silver(Tomans/Month)' },
L69:           Pro: { header: 'Gold(Tomans/Month)' },
L70:         },
L71:         flags,
L72:       );
L73:     } catch (err) {
L74:       this.debug(err);
L75:       this.error('There was a problem while getting plan info.');
L76:     }
L77:   }
L78: }
````

## knowledge/sources/cli/src/utils/detect-platform.ts

{
  "id": "liara-cli-src-utils-detect-platform-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/utils/detect-platform.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/utils/detect-platform.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/utils/detect-platform.ts",
  "sha256": "f3d41934303db321ef070d1527deca23504a5dd9093f832ef42b0cb659c09005",
  "bytes": 5130,
  "retrieved_at": "2026-10-21T15:46:53.549833+00:00"
}

````text
L1: import path from 'node:path';
L2: import { globbySync } from 'globby';
L3: import fs from 'fs-extra';
L4: 
L5: const { readJSONSync, existsSync, readFileSync } = fs;
L6: 
L7: import addNullBetweenChars from './add-null-between-chars.js';
L8: 
L9: export default function detectPlatform(projectPath: string) {
L10:   const pipfilePath = path.join(projectPath, 'Pipfile');
L11:   const pyprojectFilePath = path.join(projectPath, 'pyproject.toml');
L12:   const poetryFilePath = path.join(projectPath, 'poetry');
L13:   const indexPHPFilePath = path.join(projectPath, 'index.php');
L14:   const packageJsonFilePath = path.join(projectPath, 'package.json');
L15:   const composeJsonFilePath = path.join(projectPath, 'composer.json');
L16:   const requirementsTxtFilePath = path.join(projectPath, 'requirements.txt');
L17:   const goModFilePath = path.join(projectPath, 'go.mod');
L18: 
L19:   const [programCSFilePath] = globbySync('**/{Startup.cs,Program.cs}', {
L20:     cwd: projectPath,
L21:     gitignore: true,
L22:     deep: 5,
L23:   });
L24: 
L25:   const hasPipfilePathFile = existsSync(pipfilePath);
L26:   const hasPyprojectPathFile = existsSync(pyprojectFilePath);
L27:   const hasPoetryPathFile = existsSync(poetryFilePath);
L28:   const hasIndexPHPFile = existsSync(indexPHPFilePath);
L29:   const hasPackageFile = existsSync(packageJsonFilePath);
L30:   const hasComposerJsonFile = existsSync(composeJsonFilePath);
L31:   const hasRequirementsTxtFile = existsSync(requirementsTxtFilePath);
L32:   const hasDockerFile = existsSync(path.join(projectPath, 'Dockerfile'));
L33:   const hasWPContent = existsSync(path.join(projectPath, 'wp-content'));
L34:   const hasGoModFile = existsSync(goModFilePath);
L35: 
L36:   const hasCSProjFile =
L37:     programCSFilePath &&
L38:     globbySync('*.csproj', {
L39:       gitignore: true,
L40:       cwd: path.join(projectPath, path.dirname(programCSFilePath)),
L41:     }).length > 0;
L42: 
L43:   if (hasCSProjFile && hasDockerFile) {
L44:     throw new Error(`The project contains both of the \`*.csproj\` and \`Dockerfile\` files.
L45: Please specify your platform with --platform=dotnet or docker.`);
L46:   }
L47: 
L48:   if (hasCSProjFile) {
L49:     return 'dotnet';
L50:   }
L51: 
L52:   if (hasComposerJsonFile && hasDockerFile) {
L53:     throw new Error(`The project contains both of the \`composer.json\` and \`Dockerfile\` files.
L54: Please specify your platform with --platform=laravel or docker.`);
L55:   }
L56: 
L57:   if (hasComposerJsonFile) {
L58:     const composerJson = readJSONSync(composeJsonFilePath);
L59: 
L60:     if (composerJson.require && composerJson.require['laravel/framework']) {
L61:       return 'laravel';
L62:     }
L63: 
L64:     if (
L65:       composerJson.require &&
L66:       composerJson.require['laravel/lumen-framework']
L67:     ) {
L68:       return 'laravel';
L69:     }
L70: 
L71:     return 'php';
L72:   }
L73: 
L74:   if (hasIndexPHPFile) {
L75:     return 'php';
L76:   }
L77: 
L78:   if (hasPyprojectPathFile || hasPoetryPathFile) {
L79:     return 'python';
L80:   }
L81: 
L82:   if (hasRequirementsTxtFile) {
L83:     const requirementsTxt = readFileSync(requirementsTxtFilePath);
L84: 
L85:     if (
L86:       requirementsTxt.includes('Django') ||
L87:       requirementsTxt.includes('django') ||
L88:       requirementsTxt.includes(addNullBetweenChars('Django')) ||
L89:       requirementsTxt.includes(addNullBetweenChars('django'))
L90:     ) {
L91:       return 'django';
L92:     }
L93: 
L94:     if (
L95:       requirementsTxt.includes('Flask') ||
L96:       requirementsTxt.includes('flask') ||
L97:       requirementsTxt.includes(addNullBetweenChars('Flask')) ||
L98:       requirementsTxt.includes(addNullBetweenChars('flask'))
L99:     ) {
L100:       return 'flask';
L101:     }
L102: 
L103:     return 'python';
L104:   }
L105: 
L106:   if (hasPipfilePathFile) {
L107:     const pipfile = readFileSync(pipfilePath);
L108: 
L109:     if (pipfile.includes('Django') || pipfile.includes('django')) {
L110:       return 'django';
L111:     }
L112: 
L113:     if (pipfile.includes('Flask') || pipfile.includes('flask')) {
L114:       return 'flask';
L115:     }
L116: 
L117:     return 'python';
L118:   }
L119: 
L120:   if (hasPackageFile && hasDockerFile) {
L121:     throw new Error(`The project contains both of the \`package.json\` and \`Dockerfile\` files.
L122: Please specify your platform with --platform=node or docker.`);
L123:   }
L124: 
L125:   if (hasPackageFile) {
L126:     const packageJson = readJSONSync(packageJsonFilePath);
L127: 
L128:     if (packageJson?.dependencies?.next) {
L129:       return 'next';
L130:     }
L131: 
L132:     if (packageJson.dependencies && packageJson.dependencies['@angular/core']) {
L133:       return 'angular';
L134:     }
L135: 
L136:     if (
L137:       (packageJson.devDependencies &&
L138:         packageJson.devDependencies['@vue/cli-service']) ||
L139:       (packageJson.dependencies?.vue && packageJson.devDependencies?.vite)
L140:     ) {
L141:       return 'vue';
L142:     }
L143: 
L144:     if (
L145:       (packageJson.dependencies && packageJson.dependencies['react-scripts']) ||
L146:       (packageJson.devDependencies?.vite && packageJson.dependencies?.react) ||
L147:       packageJson.dependencies?.preact
L148:     ) {
L149:       return 'react';
L150:     }
L151: 
L152:     return 'node';
L153:   }
L154: 
L155:   if (hasWPContent && hasDockerFile) {
L156:     throw new Error(`The project contains a \`Dockerfile\`.
L157: Please specify your platform with --platform=wordpress or docker.`);
L158:   }
L159: 
L160:   if (hasWPContent) {
L161:     return 'wordpress';
L162:   }
L163: 
L164:   if (hasGoModFile && hasDockerFile) {
L165:     throw new Error(`The project contains both of the \`go.mod\` and \`Dockerfile\` files.
L166: Please specify your platform with --platform=go or docker.`);
L167:   }
L168: 
L169:   if (hasGoModFile) {
L170:     return 'go';
L171:   }
L172: 
L173:   if (hasDockerFile) {
L174:     return 'docker';
L175:   }
L176: 
L177:   return 'static';
L178: }
````

## knowledge/sources/cli/src/types/deployment-config.ts

{
  "id": "liara-cli-src-types-deployment-config-ts",
  "repository": "https://github.com/liara-cloud/cli",
  "commit": "14ec35f79d703a09a5e3abbb22ba59239cdde80d",
  "upstream_path": "src/types/deployment-config.ts",
  "url": "https://raw.githubusercontent.com/liara-cloud/cli/14ec35f79d703a09a5e3abbb22ba59239cdde80d/src/types/deployment-config.ts",
  "status": "official_reference",
  "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test.",
  "path": "knowledge/sources/cli/src/types/deployment-config.ts",
  "sha256": "0f8ff78a35e4efeb8b4916515e22a29017269ee7d7f1d1d1f2e5e0e5ff1f82f4",
  "bytes": 332,
  "retrieved_at": "2026-10-21T15:46:53.538835+00:00"
}

````text
L1: import ILiaraJSON from './liara-json.js';
L2: 
L3: export default interface IDeploymentConfig extends ILiaraJSON {
L4:   path: string;
L5:   image?: string;
L6:   'api-token'?: string;
L7:   region?: string;
L8:   message?: string;
L9:   'no-cache'?: boolean;
L10:   buildCache?: boolean;
L11:   dockerfile?: string;
L12:   'build-arg'?: string[];
L13:   'build-location'?: string;
L14: }
````
