import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";
const prisma=new PrismaClient();
async function main(){
  const branch=await prisma.branch.upsert({where:{code:"LIN"},update:{},create:{name:"Lince",code:"LIN",address:"Configurar dirección"}});
  const serviceNames=["Registro","Consulta","Efectivización","Pago de deuda","Plan de retención"];
  const services=await Promise.all(serviceNames.map(name=>prisma.service.upsert({where:{name},update:{},create:{name}})));
  const banks=await Promise.all(["BCP","BBVA","Interbank","Scotiabank","BanBif","Falabella","POS","Link","CMR","IO","Tarjeta Comercial"].map(name=>prisma.bank.upsert({where:{name},update:{},create:{name}})));
  for(const service of services) for(const bank of banks) await prisma.rate.upsert({where:{serviceId_bankId:{serviceId:service.id,bankId:bank.id}},update:{},create:{serviceId:service.id,bankId:bank.id,rate:0}});
  const passwordHash=await bcrypt.hash("Cambiar123!",12);
  await prisma.user.upsert({where:{username:"admin"},update:{},create:{name:"Administrador General",username:"admin",passwordHash,role:UserRole.ADMIN}});
  await prisma.user.upsert({where:{username:"jefe"},update:{name:"Jefe de sede Lince",passwordHash,role:UserRole.MANAGER,active:true,branchId:branch.id},create:{name:"Jefe de sede Lince",username:"jefe",passwordHash,role:UserRole.MANAGER,branchId:branch.id}});
  await prisma.user.upsert({where:{username:"recepcion"},update:{name:"Recepción Lince",passwordHash,role:UserRole.RECEPTION,active:true,branchId:branch.id},create:{name:"Recepción Lince",username:"recepcion",passwordHash,role:UserRole.RECEPTION,branchId:branch.id}});
  const worker=await prisma.user.upsert({where:{username:"trabajador"},update:{},create:{name:"Trabajador inicial",username:"trabajador",passwordHash,role:UserRole.WORKER,branchId:branch.id}});
  for(const service of services) await prisma.workerService.upsert({where:{userId_serviceId:{userId:worker.id,serviceId:service.id}},update:{},create:{userId:worker.id,serviceId:service.id}});
  console.log("Base inicial configurada. Usuario admin / contraseña Cambiar123! (cámbiala antes de operar).");
} main().finally(()=>prisma.$disconnect());
