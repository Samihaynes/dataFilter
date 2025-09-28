<?php
// send.php
// Receives POST JSON { items: [ {email,client,invoice,amount,days} ] }
// Sends email (PHPMailer recommended). Limits to 100 emails per request for safety.


header('Content-Type: application/json');
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if(!$data || !isset($data['items'])){
echo json_encode(['success'=>false,'error'=>'Payload invalide']); exit;
}
$items = $data['items'];
$max = 100;
if(count($items) > $max) $items = array_slice($items,0,$max);


$sent = 0;


// try PHPMailer if available
if(class_exists('PHPMailer\PHPMailer\PHPMailer')){
// PHPMailer usage (assuming composer autoload in place)
require 'vendor/autoload.php';
$mail = new PHPMailer\PHPMailer\PHPMailer(true);
try{
// configure SMTP in env or here
$mail->isSMTP();
$mail->Host = getenv('SMTP_HOST') ?: 'smtp.example.com';
$mail->SMTPAuth = true;
$mail->Username = getenv('SMTP_USER') ?: 'user@example.com';
$mail->Password = getenv('SMTP_PASS') ?: 'password';
$mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
$mail->Port = getenv('SMTP_PORT') ?: 587;


$mail->setFrom('no-reply@votresociete.com', 'Votre société');


foreach($items as $it){
$to = filter_var($it['email'], FILTER_VALIDATE_EMAIL);
if(!$to) continue;
$body = "Bonjour " . ($it['client'] ?? '') . ",\n\nNotre système indique que la facture #" . ($it['invoice'] ?? '') . " d'un montant de " . ($it['amount'] ?? '') . " est en retard de " . ($it['days'] ?? '') . " jours. Merci de régulariser votre paiement dès que possible.\n\nCordialement,\nVotre société";


$mail->clearAddresses();
$mail->addAddress($to);
$mail->Subject = 'Rappel de paiement - facture ' . ($it['invoice'] ?? '');
$mail->Body = $body;
$mail->AltBody = $body;
if($mail->send()) $sent++;
}
echo json_encode(['success'=>true,'sent'=>$sent]);
}catch(Exception $e){ echo json_encode(['success'=>false,'error'=>'PHPMailer error: '.$e->getMessage()]);