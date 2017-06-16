/**
 * Created by tengzhongwei on 6/7/17.
 */

"use strict";
let Initiator           = require('../../models/initiator-model'),
    initiatorAuth       = require('../../utils/initiator-auth'),
    jwt                 = require('jsonwebtoken'),
    Joi                 = require('joi'),
    Patient             = require('../../models/patient_qrcode'),
    tempAuth            = require('../../utils/temp-auth');

module.exports = app => {

    /**
     * Create a Initiator
     *
     * @param {req.body.username} Display name of the new user
     * @param {req.body.first_name} First name of the user
     * @param {req.body.last_name} Last name of the user
     * @param {req.body.phone} Phone number of the user
     * @param {req.body.email} Email address of the user
     * @param {req.body.password} Password for the user
     * @return {200, {username,token}} Return username and json web token
     */
    app.post('/v2/accounts/initiator', (req, res) => {
        let schema = Joi.object().keys({
            username:   Joi.string().alphanum().min(5).max(10).required(),
            first_name: Joi.string().regex(/^[a-zA-Z]+$/).required(),
            last_name:  Joi.string().regex(/^[a-zA-Z]+$/).required(),
            password:   Joi.string().regex(/^[a-zA-Z0-9]{3,30}$/).required(),
            email:      Joi.string().email().required(),
            phone:      Joi.string().regex(/^[0-9]{10}$/).required(),
        });
        Joi.validate(req.body, schema, (err, data) => {
            if (err) {
                const message = err.details[0].message;
                res.status(400).send({error: message});
            } else {
                let initiator = new Initiator(data);
                initiator.save((err)=>{
                    if(err){
                        res.status(400).send({err});
                    }
                    else {
                        const token = jwt.sign(initiator, process.env.SECRET_KEY, {
                            expiresIn:"10h"
                        });
                        res.status(200).send({username: initiator.username, token:token});
                    }
                });
            }
        });
    });


    /**
     * Initiator create a temp token for patient registration
     *
     * @return {200, {token}} Return token for registration. token will expire in 30 seconds
     */
    app.get('/v2/accounts/patient/register/temp-token', initiatorAuth, (req,res)=>{
       const temp_user = {
           username:   req.user.username,
           role:        "temp",
       };
       const token = jwt.sign(temp_user, process.env.SECRET_KEY, {
           expiresIn: '30s',
       });
       res.status(200).send({token});
    });

    /**
     * Create a Patient account
     *
     * @param {req.body.uuid} Unique uuid of the user
     * @param {req.user.username} Username of the Initiator who generate the temp token
     * @return {200, {token}} Return json web token
     */
    app.post('/v2/accounts/patients/register', tempAuth, (req,res)=>{
        let schema = Joi.object().keys({
            uuid:Joi.string().guid({
                version: [
                    'uuidv4',
                    'uuidv5'
                ]})
        });
        Joi.validate(req.body, schema, (err,data) =>{
            if (err) {
                const message = err.details[0].message;
                res.status(400).send({error: message});
            } else {
                const initiator_username = req.user.username;
                Initiator.findOne({username:initiator_username}, (err, initiator)=>{
                    if(err) res.status(500).send({err});
                    else {
                        let patient = new Patient(data);
                        patient.initiators.push(initiator);
                        patient.save((err)=>{
                            if(err) res.status(500).send({err});
                            else{
                                //TODO: May exist atomic update problem
                                initiator.patients.push(patient);
                                initiator.save(err=>{
                                    if(err) res.status(500).send({err});
                                    else{
                                        const token = jwt.sign(patient, process.env.SECRET_KEY, {
                                            expiresIn: "12h",
                                        });
                                        res.status(200).send({token});
                                    }
                                })
                            }
                        });
                    }
                })
            }
        })
    });

    /**
     * Update a Patient account
     *
     * @param {req.params.uuid} Unique uuid of the user
     * @param {req.body.first_name}
     * @param {req.body.last_name}
     * @param {req.body.email}
     * @param {req.body.phone}
     * @return {200, {patient}} Return updated patient profile
     */
    app.patch('/v2/accounts/patients/:uuid/profile/update', initiatorAuth, (req, res)=>{
        let schema = Joi.object().keys({
            first_name: Joi.string().regex(/^[a-zA-Z]*$/).required(),
            last_name:  Joi.string().regex(/^[a-zA-Z]*$/).required(),
            email:      Joi.string().email().require(),
            phone:      Joi.string().regex(/^[0-9]{10}$/).required(),
        });
        Joi.validate(req.body, schema, (err,data)=>{
            if (err) {
                const message = err.details[0].message;
                res.status(400).send({error: message});
            } else {
                Patient.update({uuid:req.params.uuid}, {$set:data}, (err, patient)=>{
                    if(err) res.status(500).send({err});
                    else {
                        if (patient.length>0) res.status(200).send(patient);
                        else res.status(401).send("Invalid UUID");
                    }
                })
            }
        });
    });

    /**
     * Initiator Login
     *
     * @param {req.body.username} Username for authentication
     * @param {req.body.password} Password for authentication
     * @return {200, {patient}} Return updated patient profile
     */
    /***************** Initiator Login *******************/
    app.post('/v2/accounts/initiator/login',(req, res) => {
        let schema = Joi.object().keys({
            username:   Joi.string().alphanum().min(5).max(10).required(),
            password:   Joi.string().required(),
        });

        Joi.validate(req.body, schema, (err, data) => {
            if (err) {
                const message = err.details[0].message;
                res.status(400).send({error: message});
            } else {
                Initiator.findOne({"username":req.body.username},(err, user)=>{
                    if(err) res.status(500).send('Internal Error with Database');
                    else {
                        if(user){
                            if(user.authenticate(req.body.password)){
                                const token = jwt.sign(user, process.env.SECRET_KEY, {
                                    expiresIn:'1h'
                                });
                                res.status(200).send({username:user.username, id:user._id, token});
                            }
                            else res.status(401).send('password incorrect');
                        }
                        else res.status(401).send('user '+req.params.username+' doesnt exist');
                    }
                });
            }
        });
    });

    /**
     * Initiator generate temp token(used for QRcode) authenticate user to login
     *
     * @param {req.params.uuid} Username for authentication
     * @return {200, {patient}} Return updated patient profile
     */
    app.get('/v2/accounts/patients/:uuid/login/temp-token', initiatorAuth,(req, res)=>{
        Patient.findOne({uuid:req.params.uuid},(err,patient)=>{
            if(err) res.status(500).send('Internal Error with Database');
            else {
                if(patient){
                    const temp_user = {
                        patient_uuid:   req.params.uuid,
                        role:           'temp,'
                    };
                    const token = jwt.sign(temp_user, process.env.SECRET_KEY, {
                        expiresIn: '30s',
                    });
                }
                else res.status(400).send('UUID dose not match any user')
            }
        });
    });

    /**
     * Patient Relogin with help of initiator.
     *
     * @param {req.body.uuid} new UUID of Patient
     * @return {token} Return json web token
     */
    app.patch('v2/accounts/patients/login', tempAuth, (req, res)=>{
        const new_patient_uuid       = req.body.uuid;
        const old_patient_uuid       = req.user.patient_uuid;
        Patient.findOne({uuid:old_patient_uuid},(err, patient)=>{
            if(err) res.status(500).send('Internal Error with Database');
            else {
                if(patient){
                   patient.uuid =   new_patient_uuid;
                   patient.save(err=>{
                       if(err) res.status(500).send('Internal Error with Database');
                       else{
                           const token = jwt.sign(patient, process.env.SECRET_KEY, {
                               expiresIn: "12h",
                           });
                           res.status(200).send({token});
                       }
                   });
                }
                else res.status(400).send("uuid does not exist");
            }
        });
    });


};